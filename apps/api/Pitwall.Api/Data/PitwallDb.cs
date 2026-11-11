using Microsoft.EntityFrameworkCore;
using Pitwall.Domain;

namespace Pitwall.Data;

/// <summary>
/// The one database. No tenant filter: Pitwall has one operator (the team), and the boundary
/// that matters — one product never sees another's rows, one customer never sees another's —
/// is drawn explicitly in every customer-facing query, where it can be read and tested.
/// </summary>
public class PitwallDb(DbContextOptions<PitwallDb> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<ProductKey> ProductKeys => Set<ProductKey>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketMessage> TicketMessages => Set<TicketMessage>();
    public DbSet<TicketAttachment> TicketAttachments => Set<TicketAttachment>();
    public DbSet<ServerError> ServerErrors => Set<ServerError>();
    public DbSet<Release> Releases => Set<Release>();
    public DbSet<ReleaseNote> ReleaseNotes => Set<ReleaseNote>();
    public DbSet<StaffUser> Staff => Set<StaffUser>();
    public DbSet<StaffSession> StaffSessions => Set<StaffSession>();
    public DbSet<WebhookDelivery> WebhookDeliveries => Set<WebhookDelivery>();
    public DbSet<TeamTask> TeamTasks => Set<TeamTask>();
    public DbSet<TeamTaskComment> TeamTaskComments => Set<TeamTaskComment>();
    public DbSet<TeamTaskEvent> TeamTaskEvents => Set<TeamTaskEvent>();
    public DbSet<StaffToken> StaffTokens => Set<StaffToken>();
    public DbSet<AtlasEnvironment> AtlasEnvironments => Set<AtlasEnvironment>();
    public DbSet<AtlasService> AtlasServices => Set<AtlasService>();
    public DbSet<AtlasLink> AtlasLinks => Set<AtlasLink>();
    public DbSet<AtlasRepo> AtlasRepos => Set<AtlasRepo>();
    public DbSet<AtlasRoutine> AtlasRoutines => Set<AtlasRoutine>();
    public DbSet<AtlasRoutineRun> AtlasRoutineRuns => Set<AtlasRoutineRun>();
    public DbSet<AtlasActivity> AtlasActivities => Set<AtlasActivity>();
    public DbSet<AtlasDiscovery> AtlasDiscoveries => Set<AtlasDiscovery>();
    public DbSet<AtlasProcess> AtlasProcesses => Set<AtlasProcess>();
    public DbSet<AtlasStep> AtlasSteps => Set<AtlasStep>();
    public DbSet<AtlasEvidence> AtlasEvidence => Set<AtlasEvidence>();
    public DbSet<AtlasChange> AtlasChanges => Set<AtlasChange>();
    public DbSet<AtlasChangeSet> AtlasChangeSets => Set<AtlasChangeSet>();
    public DbSet<AtlasRef> AtlasRefs => Set<AtlasRef>();
    public DbSet<AtlasEvent> AtlasEvents => Set<AtlasEvent>();
    public DbSet<AtlasSource> AtlasSources => Set<AtlasSource>();
    public DbSet<AtlasSnapshot> AtlasSnapshots => Set<AtlasSnapshot>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AtlasEnvironment>(e =>
        {
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(80);
        });

        b.Entity<AtlasService>(e =>
        {
            e.HasIndex(x => x.Key).IsUnique();
            e.HasIndex(x => x.ProductId);
            e.HasIndex(x => new { x.Provider, x.ExternalRef });
            e.HasIndex(x => x.RetiredAt);
            e.Property(x => x.Key).HasMaxLength(160).IsRequired();
            e.Property(x => x.Engine).HasMaxLength(16).IsRequired();
            e.Property(x => x.Signature).HasMaxLength(60);
            e.Property(x => x.Origin).HasMaxLength(16).HasDefaultValue(AtlasOrigins.Declared);
            e.Property(x => x.RetiredReason).HasMaxLength(300);
            e.Property(x => x.VerifiedBy).HasMaxLength(20);
            e.Property(x => x.Version).IsRowVersion();
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Kind).HasMaxLength(16);
            e.Property(x => x.Provider).HasMaxLength(40);
            e.Property(x => x.ExternalRef).HasMaxLength(300);
            e.Property(x => x.Url).HasMaxLength(500);
            e.Property(x => x.MonitorRef).HasMaxLength(200);
            e.Property(x => x.Notes).HasMaxLength(2000);
            e.Property(x => x.MonitorStatus).HasMaxLength(16);
            e.Property(x => x.DeployStatus).HasMaxLength(16);
            e.Property(x => x.CommitSha).HasMaxLength(64);
            e.Property(x => x.Group).HasMaxLength(60);
            e.Property(x => x.Condition).HasMaxLength(16).HasDefaultValue(AtlasConditions.Ok);
            e.Property(x => x.Impact).HasMaxLength(8);
            e.Property(x => x.Owner).HasMaxLength(16);
            e.Property(x => x.TaskCode).HasMaxLength(20);
            e.OwnsMany(x => x.Facts, f => f.ToJson());
            e.Ignore(x => x.State);
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Environment).WithMany().HasForeignKey(x => x.EnvironmentId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<AtlasLink>(e =>
        {
            // One link per pair and relation: two relations between the same two nodes are two edges.
            e.HasIndex(x => new { x.FromServiceId, x.ToServiceId, x.Relation }).IsUnique();
            e.Property(x => x.Label).HasMaxLength(80);
            e.Property(x => x.Kind).HasMaxLength(16);
            e.Property(x => x.Relation).HasMaxLength(24).IsRequired().HasDefaultValue(AtlasRelations.DependsOn);
            e.Property(x => x.Origin).HasMaxLength(16).HasDefaultValue(AtlasOrigins.Declared);
            e.Property(x => x.Version).IsRowVersion();
            e.Ignore(x => x.Category);
            e.HasOne(x => x.From).WithMany().HasForeignKey(x => x.FromServiceId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.To).WithMany().HasForeignKey(x => x.ToServiceId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AtlasRepo>(e =>
        {
            e.HasIndex(x => x.FullName).IsUnique();
            e.Property(x => x.FullName).HasMaxLength(200);
            e.Property(x => x.LastRunName).HasMaxLength(200);
            e.Property(x => x.LastRunStatus).HasMaxLength(16);
            e.Property(x => x.LastRunUrl).HasMaxLength(500);
            e.Property(x => x.LastRunSha).HasMaxLength(64);
            e.Property(x => x.Role).HasMaxLength(16);
            e.Property(x => x.DefaultBranch).HasMaxLength(100);
            e.Property(x => x.ExternalId).HasMaxLength(40);
            e.Property(x => x.LastSyncSha).HasMaxLength(64);
            e.Property(x => x.LastSyncScope).HasMaxLength(16);
            e.Property(x => x.LastScanHash).HasMaxLength(64);
            e.Property(x => x.LastDeployedSha).HasMaxLength(64);
            e.OwnsMany(x => x.Stack, f => f.ToJson());
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<AtlasRoutine>(e =>
        {
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(60);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Frequency).HasMaxLength(16);
            e.Property(x => x.Description).HasMaxLength(1000);
            e.Property(x => x.Prompt).HasMaxLength(20_000);
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<AtlasRoutineRun>(e =>
        {
            e.HasIndex(x => new { x.RoutineId, x.StartedAt });
            e.HasIndex(x => x.Status);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.Summary).HasMaxLength(4000);
            e.Property(x => x.ActorName).HasMaxLength(120);
            e.OwnsMany(x => x.Links, l => l.ToJson());
            e.HasOne(x => x.Routine).WithMany(r => r.Runs).HasForeignKey(x => x.RoutineId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AtlasActivity>(e =>
        {
            e.HasIndex(x => new { x.Status, x.StartedAt });
            e.Property(x => x.Component).HasMaxLength(120);
            e.Property(x => x.Description).HasMaxLength(500);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.Result).HasMaxLength(2000);
            e.Property(x => x.ActorName).HasMaxLength(120);
            e.Property(x => x.Source).HasMaxLength(8);
            e.Property(x => x.Repo).HasMaxLength(200);
            e.Property(x => x.Branch).HasMaxLength(200);
            e.Property(x => x.HeadSha).HasMaxLength(64);
            e.Property(x => x.Tool).HasMaxLength(40);
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Service).WithMany().HasForeignKey(x => x.ServiceId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<AtlasEvidence>(e =>
        {
            e.ToTable("atlas_evidence");
            e.HasIndex(x => new { x.SubjectType, x.SubjectId, x.Source, x.Ref }).IsUnique();
            e.HasIndex(x => x.Source);
            e.HasIndex(x => x.SubjectId);
            e.Property(x => x.SubjectType).HasMaxLength(8);
            e.Property(x => x.Source).HasMaxLength(80);
            e.Property(x => x.Method).HasMaxLength(20);
            e.Property(x => x.Ref).HasMaxLength(300);
            e.Property(x => x.Detail).HasMaxLength(500);
            e.Property(x => x.Relation).HasMaxLength(24);
            e.Property(x => x.Scope).HasMaxLength(16);
            e.Property(x => x.CommitSha).HasMaxLength(64);
        });

        b.Entity<AtlasChange>(e =>
        {
            e.ToTable("atlas_changes");
            e.HasIndex(x => x.At);
            e.HasIndex(x => new { x.EntityType, x.EntityId });
            e.HasIndex(x => new { x.ProductId, x.At });
            e.Property(x => x.Actor).HasMaxLength(120);
            e.Property(x => x.Source).HasMaxLength(20);
            e.Property(x => x.EntityType).HasMaxLength(16);
            e.Property(x => x.Op).HasMaxLength(16);
            e.Property(x => x.Summary).HasMaxLength(300);
            e.OwnsMany(x => x.Fields, f => f.ToJson());
        });

        b.Entity<AtlasChangeSet>(e =>
        {
            e.ToTable("atlas_changesets");
            e.HasIndex(x => x.IdempotencyKey).IsUnique();
            e.HasIndex(x => new { x.RepoId, x.ReceivedAt });
            e.HasIndex(x => new { x.ProductId, x.ReceivedAt });
            e.Property(x => x.IdempotencyKey).HasMaxLength(120);
            e.Property(x => x.Source).HasMaxLength(20);
            e.Property(x => x.Tool).HasMaxLength(40);
            e.Property(x => x.Repo).HasMaxLength(200);
            e.Property(x => x.Branch).HasMaxLength(200);
            e.Property(x => x.CommitSha).HasMaxLength(64);
            e.Property(x => x.Scope).HasMaxLength(16);
            e.Property(x => x.Environment).HasMaxLength(40);
            e.Property(x => x.Actor).HasMaxLength(120);
            e.Property(x => x.Summary).HasMaxLength(4000);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.BundleHash).HasMaxLength(64);
            e.Property(x => x.Result).HasColumnType("jsonb");
        });

        b.Entity<AtlasRef>(e =>
        {
            e.ToTable("atlas_refs");
            e.HasIndex(x => new { x.ServiceId, x.Kind, x.Code }).IsUnique();
            e.Property(x => x.Kind).HasMaxLength(12);
            e.Property(x => x.Code).HasMaxLength(80);
            e.Property(x => x.Note).HasMaxLength(300);
            e.Property(x => x.Source).HasMaxLength(20);
            e.Property(x => x.CreatedBy).HasMaxLength(120);
            e.HasOne(x => x.Service).WithMany().HasForeignKey(x => x.ServiceId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AtlasEvent>(e =>
        {
            e.ToTable("atlas_events");
            e.HasIndex(x => x.At);
            e.HasIndex(x => new { x.ServiceId, x.At });
            e.HasIndex(x => new { x.RepoId, x.At });
            e.HasIndex(x => new { x.ProductId, x.At });
            // A delivery repeated by its provider is written once.
            e.HasIndex(x => new { x.Source, x.ExternalId }).IsUnique().HasFilter("external_id IS NOT NULL");
            e.Property(x => x.Source).HasMaxLength(20);
            e.Property(x => x.Type).HasMaxLength(40);
            e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Url).HasMaxLength(500);
            e.Property(x => x.CommitSha).HasMaxLength(64);
            e.Property(x => x.Detail).HasMaxLength(1000);
            e.Property(x => x.ExternalId).HasMaxLength(200);
        });

        b.Entity<AtlasSource>(e =>
        {
            e.ToTable("atlas_sources");
            e.HasKey(x => x.Name);
            e.Property(x => x.Name).HasMaxLength(40);
            e.Property(x => x.LastError).HasMaxLength(300);
        });

        b.Entity<AtlasSnapshot>(e =>
        {
            e.ToTable("atlas_snapshots");
            e.HasIndex(x => x.TakenAt);
            e.Property(x => x.Reason).HasMaxLength(40);
            e.Property(x => x.Hash).HasMaxLength(64);
            e.Property(x => x.Data).HasColumnType("jsonb");
        });

        b.Entity<AtlasProcess>(e =>
        {
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(60);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Description).HasMaxLength(1000);
            e.OwnsMany(x => x.Stages, s => s.ToJson());
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<AtlasStep>(e =>
        {
            e.HasIndex(x => new { x.ProcessId, x.Slug }).IsUnique();
            e.HasIndex(x => x.Status);
            e.Property(x => x.Slug).HasMaxLength(60);
            e.Property(x => x.Stage).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Status).HasMaxLength(8);
            e.Property(x => x.Owner).HasMaxLength(16);
            e.Property(x => x.Today).HasMaxLength(2000);
            e.Property(x => x.Ideal).HasMaxLength(2000);
            e.Property(x => x.Next).HasMaxLength(1000);
            e.Property(x => x.TaskCode).HasMaxLength(20);
            e.Property(x => x.Impact).HasMaxLength(8);
            e.HasOne(x => x.Process).WithMany(p => p.Steps).HasForeignKey(x => x.ProcessId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<AtlasDiscovery>(e =>
        {
            e.HasIndex(x => new { x.Source, x.Kind, x.ExternalRef }).IsUnique();
            e.Property(x => x.Source).HasMaxLength(20);
            e.Property(x => x.Kind).HasMaxLength(16);
            e.Property(x => x.ExternalRef).HasMaxLength(300);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Environment).HasMaxLength(80);
            e.Property(x => x.Url).HasMaxLength(500);
        });

        b.Entity<Product>(e =>
        {
            e.HasIndex(p => p.Slug).IsUnique();
            e.Property(p => p.Slug).HasMaxLength(40);
            e.Property(p => p.Name).HasMaxLength(80);
            e.Property(p => p.Description).HasMaxLength(1000);
            e.Property(p => p.WebhookUrl).HasMaxLength(500);
            e.Property(p => p.WebsiteUrl).HasMaxLength(300);
            e.Property(p => p.Color).HasMaxLength(7);
            e.Property(p => p.LogoContentType).HasMaxLength(40);
            e.HasOne(p => p.Owner).WithMany().HasForeignKey(p => p.OwnerId).OnDelete(DeleteBehavior.SetNull);
            e.OwnsOne(p => p.Settings, s => s.ToJson());
        });

        b.Entity<ProductKey>(e =>
        {
            e.HasIndex(k => k.Hash).IsUnique();
            e.Property(k => k.Name).HasMaxLength(80);
            e.Property(k => k.Prefix).HasMaxLength(40);
            e.HasOne(k => k.Product).WithMany(p => p.Keys).HasForeignKey(k => k.ProductId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Ticket>(e =>
        {
            e.HasIndex(t => new { t.ProductId, t.Code }).IsUnique();
            e.HasIndex(t => new { t.ProductId, t.CustomerRef, t.UpdatedAt });
            e.HasIndex(t => new { t.ProductId, t.Status, t.UpdatedAt });
            e.HasIndex(t => new { t.ProductId, t.ErrorSignature });
            e.Property(t => t.Code).HasMaxLength(16);
            e.Property(t => t.CustomerRef).HasMaxLength(100);
            e.Property(t => t.CustomerName).HasMaxLength(200);
            e.Property(t => t.OpenedByRef).HasMaxLength(100);
            e.Property(t => t.OpenedByName).HasMaxLength(200);
            e.Property(t => t.OpenedByEmail).HasMaxLength(320);
            e.Property(t => t.Title).HasMaxLength(200);
            e.Property(t => t.Category).HasMaxLength(20);
            e.Property(t => t.Severity).HasMaxLength(20);
            e.Property(t => t.Status).HasMaxLength(30);
            e.Property(t => t.Route).HasMaxLength(512);
            e.Property(t => t.DiagnosticsJson).HasColumnType("jsonb");
            e.Property(t => t.ErrorSignature).HasMaxLength(64);
            e.Property(t => t.FixedIn).HasMaxLength(120);
            e.HasOne(t => t.Product).WithMany().HasForeignKey(t => t.ProductId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(t => t.Assignee).WithMany().HasForeignKey(t => t.AssigneeId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<TicketMessage>(e =>
        {
            e.HasIndex(m => new { m.TicketId, m.CreatedAt });
            e.Property(m => m.AuthorRef).HasMaxLength(100);
            e.Property(m => m.AuthorName).HasMaxLength(200);
            e.HasOne(m => m.Ticket).WithMany(t => t.Messages).HasForeignKey(m => m.TicketId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TicketAttachment>(e =>
        {
            e.HasIndex(a => a.TicketId);
            e.Property(a => a.Kind).HasMaxLength(20);
            e.Property(a => a.Name).HasMaxLength(200);
            e.Property(a => a.ContentType).HasMaxLength(100);
            e.Property(a => a.StorageKey).HasMaxLength(300);
            e.Property(a => a.UploadedByRef).HasMaxLength(100);
            e.Property(a => a.MetaJson).HasColumnType("jsonb");
            e.HasOne(a => a.Ticket).WithMany(t => t.Attachments).HasForeignKey(a => a.TicketId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ServerError>(e =>
        {
            e.HasIndex(x => new { x.ProductId, x.TraceId });
            e.HasIndex(x => new { x.ProductId, x.Signature, x.OccurredAt });
            e.HasIndex(x => x.OccurredAt);
            e.Property(x => x.TraceId).HasMaxLength(64);
            e.Property(x => x.CustomerRef).HasMaxLength(100);
            e.Property(x => x.UserRef).HasMaxLength(100);
            e.Property(x => x.Method).HasMaxLength(10);
            e.Property(x => x.Path).HasMaxLength(512);
            e.Property(x => x.RouteTemplate).HasMaxLength(300);
            e.Property(x => x.ExceptionType).HasMaxLength(300);
            e.Property(x => x.Message).HasMaxLength(2000);
            e.Property(x => x.Signature).HasMaxLength(64);
            e.Property(x => x.Release).HasMaxLength(80);
            e.Property(x => x.Environment).HasMaxLength(40);
        });

        b.Entity<Release>(e =>
        {
            e.HasIndex(r => new { r.ProductId, r.Version }).IsUnique();
            e.HasIndex(r => new { r.ProductId, r.Status, r.PublishedAt });
            e.Property(r => r.Version).HasMaxLength(60);
            e.Property(r => r.Status).HasMaxLength(20);
            e.Property(r => r.ChangeKind).HasMaxLength(20);
            e.HasOne(r => r.Product).WithMany().HasForeignKey(r => r.ProductId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ReleaseNote>(e =>
        {
            e.HasIndex(n => new { n.ReleaseId, n.Locale }).IsUnique();
            e.Property(n => n.Locale).HasMaxLength(10);
            e.Property(n => n.Slug).HasMaxLength(160);
            e.Property(n => n.Title).HasMaxLength(120);
            e.Property(n => n.Summary).HasMaxLength(300);
            e.HasOne(n => n.Release).WithMany(r => r.Notes).HasForeignKey(n => n.ReleaseId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<StaffUser>(e =>
        {
            e.HasIndex(s => s.Email).IsUnique();
            e.Property(s => s.Email).HasMaxLength(320);
            e.Property(s => s.Name).HasMaxLength(120);
            e.Property(s => s.Role).HasMaxLength(20);
        });

        b.Entity<StaffSession>(e =>
        {
            e.HasIndex(s => s.TokenHash).IsUnique();
            e.Property(s => s.Ip).HasMaxLength(64);
            e.Property(s => s.UserAgent).HasMaxLength(300);
            e.HasOne(s => s.Staff).WithMany().HasForeignKey(s => s.StaffId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<WebhookDelivery>(e =>
        {
            e.HasIndex(w => new { w.Status, w.NextAttemptAt });
            e.HasIndex(w => new { w.ProductId, w.CreatedAt });
            e.Property(w => w.Event).HasMaxLength(60);
            e.Property(w => w.Status).HasMaxLength(20);
            e.Property(w => w.PayloadJson).HasColumnType("jsonb");
            e.Property(w => w.LastError).HasMaxLength(1000);
        });

        b.Entity<TeamTask>(e =>
        {
            e.HasIndex(t => t.Code).IsUnique();
            // The board reads one column at a time, in order, and never the archived.
            e.HasIndex(t => new { t.Status, t.Position }).HasFilter("archived_at IS NULL");
            e.HasIndex(t => t.ProductId);
            e.HasIndex(t => t.UpdatedAt);
            e.HasIndex(t => t.AssigneeId);
            e.HasIndex(t => t.ArchivedAt);
            e.Property(t => t.Code).HasMaxLength(12);
            e.Property(t => t.Title).HasMaxLength(200);
            e.Property(t => t.Body).HasMaxLength(20_000);
            e.Property(t => t.Status).HasMaxLength(16);
            e.Property(t => t.Priority).HasMaxLength(8);
            e.Property(t => t.Source).HasMaxLength(8);
            e.Property(t => t.CreatedByRef).HasMaxLength(64);
            e.Property(t => t.CreatedByName).HasMaxLength(120);
            e.Property(t => t.BlockedNote).HasMaxLength(2000);
            e.OwnsMany(t => t.Checklist, c => c.ToJson());
            e.OwnsMany(t => t.Links, l => l.ToJson());
            e.HasOne(t => t.Product).WithMany().HasForeignKey(t => t.ProductId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.Assignee).WithMany().HasForeignKey(t => t.AssigneeId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<TeamTaskComment>(e =>
        {
            e.HasIndex(c => new { c.TaskId, c.CreatedAt });
            e.Property(c => c.AuthorRef).HasMaxLength(64);
            e.Property(c => c.AuthorName).HasMaxLength(120);
            e.Property(c => c.Source).HasMaxLength(8);
            e.Property(c => c.Body).HasMaxLength(10_000);
            e.HasOne(c => c.Task).WithMany(t => t.Comments).HasForeignKey(c => c.TaskId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TeamTaskEvent>(e =>
        {
            e.HasIndex(x => new { x.TaskId, x.CreatedAt });
            e.Property(x => x.ActorRef).HasMaxLength(64);
            e.Property(x => x.ActorName).HasMaxLength(120);
            e.Property(x => x.Source).HasMaxLength(8);
            e.Property(x => x.Kind).HasMaxLength(16);
            e.Property(x => x.Data).HasColumnType("jsonb");
            e.HasOne(x => x.Task).WithMany(t => t.Events).HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<StaffToken>(e =>
        {
            e.HasIndex(t => t.Hash).IsUnique();
            e.HasIndex(t => t.StaffUserId);
            e.Property(t => t.Name).HasMaxLength(80);
            e.Property(t => t.Prefix).HasMaxLength(12);
            e.Property(t => t.Hash).HasMaxLength(64);
            e.HasOne(t => t.StaffUser).WithMany().HasForeignKey(t => t.StaffUserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
