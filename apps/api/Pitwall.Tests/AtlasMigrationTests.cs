using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Pitwall.Data;
using Testcontainers.PostgreSql;

namespace Pitwall.Tests;

/// <summary>
/// The AtlasGraph migration on an installation that already has data: nothing is lost, the keys
/// are unique and well formed, every link has its relation, the task codes and the evidence exist.
/// Its own Postgres, migrated to the last state before this change, then with rows written by hand.
/// Every name is made up (Acme, Globex).
/// </summary>
public class AtlasMigrationTests
{
    private const string Before = "20261110121901_AtlasKnowledge";
    private static readonly DateTime Verified = new(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Created = new(2026, 9, 1, 9, 0, 0, DateTimeKind.Utc);

    private static PitwallDb Open(string connectionString) =>
        new(new DbContextOptionsBuilder<PitwallDb>().UseNpgsql(connectionString).UseSnakeCaseNamingConvention().Options);

    private static async Task Exec(NpgsqlConnection c, string sql, params object?[] args)
    {
        await using var cmd = new NpgsqlCommand(sql, c);
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue($"p{i}", args[i] ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<List<object?[]>> Rows(NpgsqlConnection c, string sql, params object?[] args)
    {
        await using var cmd = new NpgsqlCommand(sql, c);
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue($"p{i}", args[i] ?? DBNull.Value);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<object?[]>();
        while (await reader.ReadAsync())
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = await reader.IsDBNullAsync(i) ? null : reader.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    [Fact]
    public async Task Existing_rows_survive_the_graph_migration_with_keys_engines_relations_and_evidence()
    {
        await using var pg = new PostgreSqlBuilder("postgres:17-alpine").Build();
        await pg.StartAsync();
        var cs = pg.GetConnectionString();

        // 1. The installation as it is today: migrated to the last state before this change.
        await using (var db = Open(cs))
            await db.GetService<IMigrator>().MigrateAsync(Before);

        var acme = Guid.NewGuid();
        var globex = Guid.NewGuid();
        var production = Guid.NewGuid();
        var staging = Guid.NewGuid();
        var apiAcme = Guid.NewGuid();
        var bancoAcme = Guid.NewGuid();
        var apiStaging = Guid.NewGuid();
        var lojinha = Guid.NewGuid();
        var apiGlobex = Guid.NewGuid();
        var relatorios = Guid.NewGuid();
        var cdn = Guid.NewGuid();
        var nameless = Guid.NewGuid();
        var paginaInicial = Guid.NewGuid();
        var repo = Guid.NewGuid();

        await using (var conn = new NpgsqlConnection(cs))
        {
            await conn.OpenAsync();
            await Exec(conn, "INSERT INTO products (id, slug, name, settings, created_at, updated_at) VALUES (@p0, @p1, @p2, '{}'::jsonb, @p3, @p3)", acme, "acme", "Acme", Created);
            await Exec(conn, "INSERT INTO products (id, slug, name, settings, created_at, updated_at) VALUES (@p0, @p1, @p2, '{}'::jsonb, @p3, @p3)", globex, "globex", "Globex", Created);
            await Exec(conn, "INSERT INTO atlas_environments (id, slug, name, position, created_at) VALUES (@p0, 'production', 'Produção', 0, @p1)", production, Created);
            await Exec(conn, "INSERT INTO atlas_environments (id, slug, name, position, created_at) VALUES (@p0, 'staging', 'Staging', 1, @p1)", staging, Created);

            // Services: accented names, the same name in two systems, a task code, a verified railway service,
            // a monitored one, a shared outside service, and a service with no name at all.
            const string service = """
                INSERT INTO atlas_services (id, product_id, environment_id, name, kind, provider, external_ref, monitor_ref,
                    condition, facts, items, task_code, monitor_status, checked_at, created_at, updated_at)
                VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, 'ok', '[]'::jsonb, '{}', @p8, @p9, @p10, @p11, @p11)
                """;
            await Exec(conn, service, apiAcme, acme, production, "API Ação", "api", "railway", "acme/api", null, null, null, Verified, Created);
            await Exec(conn, service, bancoAcme, acme, production, "Banco", "database", "railway", null, null, "T-AB123", null, null, Created);
            await Exec(conn, service, apiStaging, acme, staging, "API Ação", "api", null, null, null, null, null, null, Created);
            await Exec(conn, service, lojinha, acme, production, "Lojinha São João", "web", null, null, "Lojinha", null, "up", Verified, Created);
            await Exec(conn, service, apiGlobex, globex, production, "API Ação", "api", null, null, null, null, null, null, Created);
            await Exec(conn, service, relatorios, globex, production, "Relatórios", "worker", null, null, null, null, null, null, Created);
            await Exec(conn, service, cdn, null, null, "CDN Acme", "cdn", "cloudflare", null, null, null, null, null, Created);
            await Exec(conn, service, nameless, acme, null, "", "other", null, null, null, null, null, null, Created);
            await Exec(conn, service, paginaInicial, acme, production, "Página inicial", "site", null, null, null, null, null, null, Created);

            // Links: an old host kind, an old monitor kind, and a link with no kind at all.
            const string link = "INSERT INTO atlas_links (id, from_service_id, to_service_id, kind, planned, created_at) VALUES (@p0, @p1, @p2, @p3, false, @p4)";
            await Exec(conn, link, Guid.NewGuid(), apiAcme, bancoAcme, "host", Created);
            await Exec(conn, link, Guid.NewGuid(), lojinha, cdn, "monitor", Created);
            await Exec(conn, link, Guid.NewGuid(), apiAcme, cdn, null, Created);

            await Exec(conn, "INSERT INTO atlas_repos (id, product_id, full_name, created_at) VALUES (@p0, @p1, 'acme-inc/acme-api', @p2)", repo, acme, Created);
        }

        // 2. The migration itself.
        await using (var db = Open(cs))
            await db.Database.MigrateAsync();

        await using var check = new NpgsqlConnection(cs);
        await check.OpenAsync();

        // Nothing is lost.
        Assert.Equal(9L, (long)(await Rows(check, "SELECT count(*) FROM atlas_services"))[0][0]!);
        Assert.Equal(3L, (long)(await Rows(check, "SELECT count(*) FROM atlas_links"))[0][0]!);
        Assert.Equal(1L, (long)(await Rows(check, "SELECT count(*) FROM atlas_repos"))[0][0]!);
        Assert.Equal(2L, (long)(await Rows(check, "SELECT count(*) FROM products"))[0][0]!);

        // Keys: formed as the contract says, accents out, the same name in two systems kept apart, unique.
        var keys = (await Rows(check, "SELECT key FROM atlas_services")).Select(r => (string)r[0]!).ToList();
        Assert.Equal(
            new[]
            {
                "acme:any:servico", "acme:production:api-acao", "acme:production:banco", "acme:production:lojinha-sao-joao",
                "acme:production:pagina-inicial", "acme:staging:api-acao", "globex:production:api-acao",
                "globex:production:relatorios", "shared:any:cdn-acme",
            },
            keys.OrderBy(k => k, StringComparer.Ordinal));
        Assert.Equal(keys.Count, keys.Distinct().Count());

        async Task<string?> KeyOf(Guid id) => (string?)(await Rows(check, "SELECT key FROM atlas_services WHERE id = @p0", id))[0][0];
        Assert.Equal("acme:production:api-acao", await KeyOf(apiAcme));
        Assert.Equal("acme:staging:api-acao", await KeyOf(apiStaging));
        Assert.Equal("globex:production:api-acao", await KeyOf(apiGlobex));

        // Engines by kind (table 1.2): a site is marketing, a cdn is infrastructure, the rest are applications.
        var engines = (await Rows(check, "SELECT id, engine FROM atlas_services")).ToDictionary(r => (Guid)r[0]!, r => (string)r[1]!);
        Assert.Equal("app", engines[apiAcme]);
        Assert.Equal("app", engines[bancoAcme]);
        Assert.Equal("infra", engines[cdn]);
        Assert.Equal("marketing", engines[paginaInicial]);
        Assert.Equal("app", engines[nameless]);

        // Relations from the old kinds; an old link never changes its endpoints; updated_at starts at creation.
        var links = await Rows(check, "SELECT from_service_id, to_service_id, relation, origin, created_at, updated_at FROM atlas_links");
        string RelationOf(Guid from, Guid to) => (string)links.Single(l => (Guid)l[0]! == from && (Guid)l[1]! == to)[2]!;
        Assert.Equal("hosted_on", RelationOf(apiAcme, bancoAcme));
        Assert.Equal("monitored_by", RelationOf(lojinha, cdn));
        Assert.Equal("depends_on", RelationOf(apiAcme, cdn));
        Assert.All(links, l => Assert.Equal("declared", (string)l[3]!));
        Assert.All(links, l => Assert.Equal((DateTime)l[4]!, (DateTime)l[5]!));

        // The task code became a reference to the task.
        var refs = await Rows(check, "SELECT service_id, kind, code FROM atlas_refs");
        Assert.Single(refs);
        Assert.Equal(bancoAcme, (Guid)refs[0][0]!);
        Assert.Equal(("task", "T-AB123"), ((string)refs[0][1]!, (string)refs[0][2]!));

        // Evidence: every service has the import; the two confirmed by a collector have theirs.
        Assert.Equal(9L, (long)(await Rows(check, "SELECT count(*) FROM atlas_evidence WHERE source = 'import' AND method = 'manual' AND ref = 'atlas' AND scope = 'declared'"))[0][0]!);
        var collectors = await Rows(check, "SELECT subject_id, source, ref, scope, first_seen_at FROM atlas_evidence WHERE source LIKE 'collector:%'");
        Assert.Equal(2, collectors.Count);
        var railway = collectors.Single(r => (Guid)r[0]! == apiAcme);
        Assert.Equal(("collector:railway", "railway:acme/api", "runtime"), ((string)railway[1]!, (string)railway[2]!, (string)railway[3]!));
        Assert.Equal(Verified, (DateTime)railway[4]!);
        var kuma = collectors.Single(r => (Guid)r[0]! == lojinha);
        Assert.Equal(("collector:kuma", ":Lojinha", "runtime"), ((string)kuma[1]!, (string)kuma[2]!, (string)kuma[3]!));

        // Verification comes from the last check; a service never checked stays unverified.
        var verified = await Rows(check, "SELECT id, verified_at, verified_by FROM atlas_services WHERE verified_at IS NOT NULL ORDER BY verified_by");
        Assert.Equal(2, verified.Count);
        // Ordered by verified_by: kuma first, railway second.
        Assert.Equal((lojinha, "kuma"), ((Guid)verified[0][0]!, (string)verified[0][2]!));
        Assert.Equal((apiAcme, "railway"), ((Guid)verified[1][0]!, (string)verified[1][2]!));
        Assert.Equal(Verified, (DateTime)verified[1][1]!);
        Assert.Equal(7L, (long)(await Rows(check, "SELECT count(*) FROM atlas_services WHERE verified_at IS NULL"))[0][0]!);

        // Stack and service ids of the old repository are empty lists, not nulls.
        var repoRow = await Rows(check, "SELECT service_ids::text, stack::text FROM atlas_repos");
        Assert.Equal(("{}", "[]"), ((string)repoRow[0][0]!, (string)repoRow[0][1]!));

        // The constraints the migration adds are there: a second service with the same key is refused,
        // and a second link for the same pair is refused only when the relation is the same.
        var duplicateKey = await Assert.ThrowsAsync<PostgresException>(() => Exec(check,
            "INSERT INTO atlas_services (id, product_id, name, kind, key, engine, origin, aliases, condition, facts, items, created_at, updated_at) " +
            "VALUES (@p0, @p1, 'Outro', 'api', 'acme:production:api-acao', 'app', 'declared', '{}', 'ok', '[]'::jsonb, '{}', @p2, @p2)",
            Guid.NewGuid(), acme, Created));
        Assert.Equal("23505", duplicateKey.SqlState);
        await Exec(check, "INSERT INTO atlas_links (id, from_service_id, to_service_id, relation, origin, created_at, updated_at, planned) VALUES (@p0, @p1, @p2, 'calls', 'declared', @p3, @p3, false)",
            Guid.NewGuid(), apiAcme, bancoAcme, Created);
        var samePair = await Assert.ThrowsAsync<PostgresException>(() => Exec(check,
            "INSERT INTO atlas_links (id, from_service_id, to_service_id, relation, origin, created_at, updated_at, planned) VALUES (@p0, @p1, @p2, 'hosted_on', 'declared', @p3, @p3, false)",
            Guid.NewGuid(), apiAcme, bancoAcme, Created));
        Assert.Equal("23505", samePair.SqlState);

        // The application reads the migrated rows through the model.
        await using var app = Open(cs);
        var migrated = await app.AtlasServices.AsNoTracking().ToListAsync();
        Assert.Equal(9, migrated.Count);
        Assert.All(migrated, s => Assert.False(string.IsNullOrWhiteSpace(s.Key)));
        Assert.Equal("app", migrated.Single(s => s.Id == apiAcme).Engine);
        Assert.Equal("declared", migrated.Single(s => s.Id == apiAcme).Origin);
    }
}
