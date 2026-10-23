using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Webhooks;

namespace Pitwall.Services.Releases;

public sealed record IngestReleaseRequest(
    string? Version, List<ReleaseCommit>? Commits, bool DryRun = false, string? Context = null,
    DateTime? PublishedAt = null, bool? Announce = null);

public sealed record IngestOutcome(
    string Status, Guid? ReleaseId = null, NoteDraft? Draft = null, string? Reason = null,
    IReadOnlyList<string>? ResolvedTickets = null);

/// <summary>
/// What happens when a release ships. Two things, independent of each other:
///
///  1. The code is out. Every ticket the commits mention by code (<c>fix: export (20261016-7K3Q)</c>),
///     and every ticket whose "fixed in" names one of the commits, is resolved now — whether or
///     not the release gets a note. A bug fix rarely makes a customer-facing note; the customer
///     who reported it still hears it is done.
///  2. The note. Written by the model, published at once or kept as a draft, per product.
///
/// One release per version: a retried pipeline run answers "exists" and changes nothing.
/// </summary>
public sealed partial class ReleasePublisher(PitwallDb db, ReleaseWriter writer, ILogger<ReleasePublisher> logger)
{
    public const string Silent = "silent";

    public async Task<IngestOutcome> IngestAsync(Product product, IngestReleaseRequest req, CancellationToken ct)
    {
        var version = req.Version?.Trim();
        if (string.IsNullOrWhiteSpace(version) || version.Length > 60)
            return new IngestOutcome("failed", Reason: "a version of up to 60 characters is required");
        var commits = (req.Commits ?? [])
            .Where(c => !string.IsNullOrWhiteSpace(c.Subject))
            .Select(c => c with { Sha = (c.Sha ?? "").Trim(), Subject = c.Subject.Trim() })
            .ToList();
        if (await db.Releases.AsNoTracking().AnyAsync(r => r.ProductId == product.Id && r.Version == version, ct))
            return new IngestOutcome("exists", Reason: $"a release {version} already exists");
        if (commits.Count == 0) return new IngestOutcome("skipped", Reason: "no commits");

        var recent = await db.ReleaseNotes.AsNoTracking()
            .Where(n => n.Release.ProductId == product.Id && n.Release.Status == ReleaseStatuses.Published
                        && n.Locale == (product.Settings.Locales.FirstOrDefault() ?? "pt"))
            .OrderByDescending(n => n.Release.PublishedAt).Take(5).Select(n => n.Title).ToListAsync(ct);

        var now = DateTime.UtcNow;
        var codes = commits.SelectMany(c => TicketCodes.FindIn(c.Subject).Concat(TicketCodes.FindIn(c.Body)))
            .Distinct().Take(200).ToArray();
        var release = new Release
        {
            Id = Guid.NewGuid(), ProductId = product.Id, Version = version,
            Status = Silent,
            CommitShas = commits.Select(c => c.Sha).Where(s => s.Length > 0).Take(500).ToArray(),
            TicketCodes = codes,
            Announce = req.Announce ?? true,
            CreatedAt = now, UpdatedAt = now,
        };

        var draft = await writer.WriteAsync(product, version, commits, recent, req.Context, ct);
        var noteworthy = draft is not null && draft.Publish && draft.Notes.Count > 0 && draft.Notes.Values.All(n => !n.IsEmpty);
        if (req.DryRun)
            return draft is null
                ? new IngestOutcome("failed", Reason: "the model did not return a usable note")
                : new IngestOutcome(noteworthy ? "dry-run" : "skipped", Draft: draft, Reason: noteworthy ? null : "nothing a customer would notice");

        // The code shipped whether or not the note could be written: the tickets it fixed are
        // resolved either way. A failed note leaves no release row, so the next run retries it.
        var resolved = await ResolveShippedTicketsAsync(product, release, now, ct);
        if (draft is null)
        {
            await db.SaveChangesAsync(ct);
            return new IngestOutcome("failed", Reason: "the model did not return a usable note", ResolvedTickets: resolved);
        }
        db.Releases.Add(release);

        if (noteworthy)
        {
            release.ChangeKind = draft.Notes.Values.Any(n => n.New.Count > 0) ? "feature" : "improvement";
            foreach (var (locale, text) in draft.Notes)
            {
                db.ReleaseNotes.Add(new ReleaseNote
                {
                    Id = Guid.NewGuid(), ReleaseId = release.Id, Locale = locale,
                    Slug = Slug($"{text.Title} {version}"),
                    Title = text.Title, Summary = text.Summary,
                    NewItems = [.. text.New], Improvements = [.. text.Improvements],
                    BodyMarkdown = ReleaseWriter.Markdown(text, locale),
                });
            }
            release.Status = ReleaseStatuses.Draft;
        }

        if (noteworthy && product.Settings.AutoPublishReleases)
        {
            // Past releases written now (backfill) keep the date they shipped, so the timeline reads in order.
            var at = req.PublishedAt is { } past && past < now ? DateTime.SpecifyKind(past, DateTimeKind.Utc) : now;
            await db.SaveChangesAsync(ct);
            await PublishAsync(product, release.Id, at, ct);
        }
        else
        {
            await db.SaveChangesAsync(ct);
        }

        logger.LogInformation("Release {Product} {Version}: {Status}, {Tickets} ticket(s) resolved",
            product.Slug, version, release.Status, resolved.Count);
        var status = !noteworthy ? "skipped" : product.Settings.AutoPublishReleases ? "published" : "draft";
        return new IngestOutcome(status, release.Id, draft, noteworthy ? null : "nothing a customer would notice", resolved);
    }

    /// <summary>Makes a drafted release public and tells the product, once.</summary>
    public async Task<bool> PublishAsync(Product product, Guid releaseId, DateTime? at, CancellationToken ct)
    {
        var release = await db.Releases.Include(r => r.Notes)
            .FirstOrDefaultAsync(r => r.Id == releaseId && r.ProductId == product.Id, ct);
        if (release is null || release.Notes.Count == 0) return false;
        if (release.Status == ReleaseStatuses.Published) return true;
        var now = DateTime.UtcNow;
        release.Status = ReleaseStatuses.Published;
        release.PublishedAt = at ?? now;
        release.UpdatedAt = now;
        if (release.Announce)
        {
            WebhookOutbox.Enqueue(db, product, WebhookEvents.ReleasePublished, new
            {
                release.Id, release.Version, release.ChangeKind, release.PublishedAt,
                // The whole note, so a product can mirror it into its own "what's new" without calling back.
                notes = release.Notes.ToDictionary(n => n.Locale, n => new
                {
                    n.Title, n.Summary, n.Slug, @new = n.NewItems, n.Improvements, n.BodyMarkdown,
                }),
            });
        }
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// Tickets this release fixed, by code in a commit or by a "fixed in" that names one of its
    /// commits (or the version). Only tickets still open count; a resolved ticket stays as it is.
    /// </summary>
    private async Task<List<string>> ResolveShippedTicketsAsync(Product product, Release release, DateTime now, CancellationToken ct)
    {
        var codes = release.TicketCodes;
        var shaPrefixes = release.CommitShas.Where(s => s.Length >= 7).ToArray();
        var candidates = await db.Tickets
            .Where(t => t.ProductId == product.Id && TicketStatuses.Active.Contains(t.Status)
                        && (codes.Contains(t.Code) || t.FixedIn != null))
            .ToListAsync(ct);

        var resolved = new List<string>();
        foreach (var t in candidates)
        {
            var byCode = codes.Contains(t.Code);
            var byFixedIn = t.FixedIn is { Length: > 0 } f
                && (f == release.Version || (f.Length >= 7 && shaPrefixes.Any(s => s.StartsWith(f, StringComparison.OrdinalIgnoreCase))));
            if (!byCode && !byFixedIn) continue;
            var before = t.Status;
            t.FixedIn = release.Version;
            t.ApplyStatus(TicketStatuses.Resolved, now);
            WebhookOutbox.Enqueue(db, product, WebhookEvents.TicketStatusChanged, new
            {
                ticket = WebhookOutbox.TicketData(t), from = before, to = t.Status, reason = "release",
            });
            resolved.Add(t.Code);
        }
        return resolved;
    }

    public static string Slug(string text)
    {
        var normalized = text.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder();
        foreach (var ch in normalized)
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) sb.Append(ch);
        var slug = NonSlug().Replace(sb.ToString().ToLowerInvariant(), "-").Trim('-');
        return slug.Length <= 150 ? slug : slug[..150].TrimEnd('-');
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlug();
}
