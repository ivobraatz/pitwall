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

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Product>(e =>
        {
            e.HasIndex(p => p.Slug).IsUnique();
            e.Property(p => p.Slug).HasMaxLength(40);
            e.Property(p => p.Name).HasMaxLength(80);
            e.Property(p => p.Description).HasMaxLength(1000);
            e.Property(p => p.WebhookUrl).HasMaxLength(500);
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
    }
}
