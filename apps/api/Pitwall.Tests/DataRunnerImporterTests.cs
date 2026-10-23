using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Pitwall.Data;
using Pitwall.Domain;
using Pitwall.Services.Storage;
using Pitwall.Tools;

namespace Pitwall.Tests;

/// <summary>
/// DataRunner's support history moves into Pitwall without losing a conversation: same ids, the
/// team's replies attributed to the right person, recordings with their bytes, and server errors
/// re-signed so the ticket still groups with them. Run twice, it adds nothing.
/// </summary>
public class DataRunnerImporterTests(PitwallFixture fx) : IClassFixture<PitwallFixture>
{
    private const string Schema = """
        CREATE TABLE workspaces (id uuid PRIMARY KEY, name text);
        CREATE TABLE users (id uuid PRIMARY KEY, email text, display_name text);
        CREATE TABLE legacy_support_tickets (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, code text, opened_by uuid, title text, body text,
          category text, severity text, status text, assignee_id uuid, route text, diagnostics jsonb, trace_ids text, error_signature text,
          fixed_in text, resolution_note text, created_at timestamptz, updated_at timestamptz, last_customer_message_at timestamptz,
          last_admin_message_at timestamptz, resolved_at timestamptz, closed_at timestamptz);
        CREATE TABLE legacy_support_ticket_messages (id uuid PRIMARY KEY, workspace_id uuid, ticket_id uuid, author_id uuid, from_admin boolean, internal boolean, body text, created_at timestamptz);
        CREATE TABLE legacy_support_ticket_attachments (id uuid PRIMARY KEY, workspace_id uuid, ticket_id uuid, message_id uuid, uploaded_by uuid, kind text, name text, content_type text, size_bytes bigint, storage_key text, meta jsonb, created_at timestamptz);
        CREATE TABLE legacy_server_errors (id uuid PRIMARY KEY, trace_id text, workspace_id uuid, user_id uuid, method text, path text, route_template text, status_code int, exception_type text, message text, stack_trace text, signature text, release text, occurred_at timestamptz);
        INSERT INTO workspaces VALUES ('11111111-1111-1111-1111-111111111111','Padaria São João');
        INSERT INTO users VALUES ('22222222-2222-2222-2222-222222222222','maria@padaria.test','Maria Conceição'),
                                 ('33333333-3333-3333-3333-333333333333','suporte@datarunner.test','Ivo');
        INSERT INTO legacy_support_tickets VALUES ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','20260920-AB12',
          '22222222-2222-2222-2222-222222222222','Relatório não exporta','Clico em exportar e nada.','bug','high','waiting_customer',
          '33333333-3333-3333-3333-333333333333','/reports/view?id=9','{"context":{"route":"/reports/view"}}',
          '["tr-1"]','oldsig123',null,'timeout no export',now()-interval '5 days',now()-interval '1 day',now()-interval '5 days',now()-interval '1 day',null,null);
        INSERT INTO legacy_support_ticket_messages VALUES
         ('55555555-5555-5555-5555-555555555551',null,'44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',true,true,'nota interna',now()-interval '2 days'),
         ('55555555-5555-5555-5555-555555555552',null,'44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',true,false,'Pode testar de novo?',now()-interval '1 day');
        INSERT INTO legacy_support_ticket_attachments VALUES ('66666666-6666-6666-6666-666666666666',null,'44444444-4444-4444-4444-444444444444',null,
          '22222222-2222-2222-2222-222222222222','recording','recording.json','application/json',9,'support/ws1/t1/a1.json','{"mode":"retroactive"}',now()-interval '5 days');
        INSERT INTO legacy_server_errors VALUES ('77777777-7777-7777-7777-777777777777','tr-1','11111111-1111-1111-1111-111111111111',null,
          'POST','/api/v1/reports/9/export','/api/v1/reports/{id}/export',500,'System.TimeoutException','timed out',
          E'System.TimeoutException\n   at DataRunner.Export.Run() in /src/Export.cs:line 10','oldsig123','0.2.900',now()-interval '5 days');
        """;

    [Fact]
    public async Task Imports_datarunner_support_history_once()
    {
        var (product, _, _, _) = await fx.SeedProductAsync();
        var sourceDb = "dr_" + Guid.NewGuid().ToString("N")[..8];
        var pitwallConn = new NpgsqlConnectionStringBuilder(fx.ConnectionString);
        await using (var admin = new NpgsqlConnection(pitwallConn.ConnectionString))
        {
            await admin.OpenAsync();
            await new NpgsqlCommand($"CREATE DATABASE {sourceDb}", admin).ExecuteNonQueryAsync();
        }
        var sourceConn = new NpgsqlConnectionStringBuilder(fx.ConnectionString) { Database = sourceDb }.ConnectionString;
        await using (var src = new NpgsqlConnection(sourceConn))
        {
            await src.OpenAsync();
            await new NpgsqlCommand(Schema, src).ExecuteNonQueryAsync();
        }
        var blobs = Path.Combine(Path.GetTempPath(), "pitwall-import-src", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(blobs, "support", "ws1", "t1"));
        await File.WriteAllTextAsync(Path.Combine(blobs, "support", "ws1", "t1", "a1.json"), "[{\"t\":1}]");

        using var scope = fx.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitwallDb>();
        db.Staff.Add(new StaffUser { Id = Guid.NewGuid(), Email = "suporte@datarunner.test", Name = "Ivo (equipe)", PasswordHash = "x", CreatedAt = DateTime.UtcNow });
        var p = await db.Products.FirstAsync(x => x.Id == product.Id);
        p.Settings.OwnFramePrefixes = ["DataRunner."];
        await db.SaveChangesAsync();

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Import:SourceConnectionString"] = sourceConn,
            ["Import:ProductSlug"] = product.Slug,
            ["Import:SourceStorage:Provider"] = "fs",
            ["Import:SourceStorage:Path"] = blobs,
        }).Build();
        var store = scope.ServiceProvider.GetRequiredService<AttachmentStore>();
        var importer = new DataRunnerImporter(db, store, config, NullLogger<DataRunnerImporter>.Instance);

        var first = await importer.RunAsync(dryRun: false, CancellationToken.None);
        Assert.Equal(new DataRunnerImporter.Result(1, 2, 1, 0, 1, 0), first);

        db.ChangeTracker.Clear();
        var ticket = await db.Tickets.AsNoTracking().Include(t => t.Messages).Include(t => t.Attachments)
            .FirstAsync(t => t.Id == Guid.Parse("44444444-4444-4444-4444-444444444444"));
        Assert.Equal("20260920-AB12", ticket.Code);
        Assert.Equal("11111111-1111-1111-1111-111111111111", ticket.CustomerRef);
        Assert.Equal("Padaria São João", ticket.CustomerName);
        Assert.Equal("Maria Conceição", ticket.OpenedByName);
        Assert.Equal(["tr-1"], ticket.TraceIds);
        Assert.NotNull(ticket.AssigneeId);
        Assert.Contains(ticket.Messages, m => m.Internal && m.FromTeam && m.AuthorName == "Ivo (equipe)");

        var error = await db.ServerErrors.AsNoTracking().FirstAsync(e => e.ProductId == product.Id);
        Assert.Equal(error.Signature, ticket.ErrorSignature);
        Assert.NotEqual("oldsig123", ticket.ErrorSignature);

        var bytes = await store.GetAsync(ticket.Attachments.Single().StorageKey, CancellationToken.None);
        Assert.NotNull(bytes);
        using (var reader = new StreamReader(bytes!)) Assert.Equal("[{\"t\":1}]", await reader.ReadToEndAsync());

        var again = await importer.RunAsync(dryRun: false, CancellationToken.None);
        Assert.Equal(new DataRunnerImporter.Result(0, 0, 0, 0, 0, 1), again);
    }
}
