using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pitwall.Data.Migrations
{
    /// <inheritdoc />
    public partial class AtlasGraph : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The new columns start nullable, so the rows already there keep their place while they are backfilled.
            migrationBuilder.DropIndex(
                name: "ix_atlas_links_from_service_id_to_service_id",
                table: "atlas_links");

            migrationBuilder.AddColumn<List<string>>(
                name: "aliases",
                table: "atlas_services",
                type: "text[]",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "engine",
                table: "atlas_services",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "key",
                table: "atlas_services",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "missing_since",
                table: "atlas_services",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "origin",
                table: "atlas_services",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "removal_reported_at",
                table: "atlas_services",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "retired_at",
                table: "atlas_services",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "retired_reason",
                table: "atlas_services",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "signature",
                table: "atlas_services",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "verified_at",
                table: "atlas_services",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "verified_by",
                table: "atlas_services",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<uint>(
                name: "xmin",
                table: "atlas_services",
                type: "xid",
                rowVersion: true,
                nullable: false,
                defaultValue: 0u);

            migrationBuilder.AddColumn<string>(
                name: "default_branch",
                table: "atlas_repos",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "external_id",
                table: "atlas_repos",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "last_deployed_sha",
                table: "atlas_repos",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "last_scan_hash",
                table: "atlas_repos",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "last_sync_at",
                table: "atlas_repos",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "last_sync_scope",
                table: "atlas_repos",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "last_sync_sha",
                table: "atlas_repos",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "open_pull_requests",
                table: "atlas_repos",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "retired_at",
                table: "atlas_repos",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "role",
                table: "atlas_repos",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<List<Guid>>(
                name: "service_ids",
                table: "atlas_repos",
                type: "uuid[]",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "stack",
                table: "atlas_repos",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "origin",
                table: "atlas_links",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "relation",
                table: "atlas_links",
                type: "character varying(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "retired_at",
                table: "atlas_links",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "updated_at",
                table: "atlas_links",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "verified_at",
                table: "atlas_links",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<uint>(
                name: "xmin",
                table: "atlas_links",
                type: "xid",
                rowVersion: true,
                nullable: false,
                defaultValue: 0u);

            migrationBuilder.AddColumn<string>(
                name: "branch",
                table: "atlas_activities",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "head_sha",
                table: "atlas_activities",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "last_sync_at",
                table: "atlas_activities",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "repo",
                table: "atlas_activities",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "tool",
                table: "atlas_activities",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "atlas_changes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    actor = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    change_set_id = table.Column<Guid>(type: "uuid", nullable: true),
                    entity_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    op = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    summary = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    fields = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_changes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "atlas_changesets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    idempotency_key = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    tool = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    repo_id = table.Column<Guid>(type: "uuid", nullable: true),
                    repo = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    branch = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    commit_sha = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    scope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    environment = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    actor = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    activity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    summary = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    task_codes = table.Column<List<string>>(type: "text[]", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    bundle_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    received_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    applied_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    result = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_changesets", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "atlas_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    service_id = table.Column<Guid>(type: "uuid", nullable: true),
                    repo_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    commit_sha = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    detail = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    external_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "atlas_evidence",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    subject_type = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    subject_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    method = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    @ref = table.Column<string>(name: "ref", type: "character varying(300)", maxLength: 300, nullable: false),
                    detail = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    relation = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    scope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    commit_sha = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    change_set_id = table.Column<Guid>(type: "uuid", nullable: true),
                    first_seen_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    gone_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_evidence", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "atlas_refs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    service_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    note = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_by = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_refs", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_refs_atlas_services_service_id",
                        column: x => x.service_id,
                        principalTable: "atlas_services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "atlas_snapshots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    taken_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    reason = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    node_count = table.Column<int>(type: "integer", nullable: false),
                    edge_count = table.Column<int>(type: "integer", nullable: false),
                    data = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_snapshots", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "atlas_sources",
                columns: table => new
                {
                    name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    last_run_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_ok_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_error = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    items_seen = table.Column<int>(type: "integer", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_sources", x => x.name);
                });

            // Backfill: every row that existed gets its key, engine, verification, relation and evidence
            // from what it already said. Nothing is removed or renamed.
            migrationBuilder.Sql(@"
                UPDATE atlas_services SET origin = 'declared' WHERE origin IS NULL;
                UPDATE atlas_services SET aliases = '{}' WHERE aliases IS NULL;
                UPDATE atlas_repos SET service_ids = '{}' WHERE service_ids IS NULL;
                UPDATE atlas_repos SET stack = '[]' WHERE stack IS NULL;
                UPDATE atlas_links SET origin = 'declared' WHERE origin IS NULL;
            ");

            // Key: system-or-shared : environment-or-any : slug of the name. Accents go, the name's
            // non a-z0-9 runs become dashes, at most 60; an empty name is 'servico'. Repeats get -2, -3…
            migrationBuilder.Sql(@"
                WITH base AS (
                    SELECT s.id, s.created_at,
                        coalesce(p.slug, 'shared') || ':' || coalesce(e.slug, 'any') || ':' ||
                        coalesce(nullif(trim(both '-' from left(trim(both '-' from regexp_replace(
                            translate(lower(s.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
                            '[^a-z0-9]+', '-', 'g')), 60)), ''), 'servico') AS k
                    FROM atlas_services s
                    LEFT JOIN products p ON p.id = s.product_id
                    LEFT JOIN atlas_environments e ON e.id = s.environment_id
                ),
                numbered AS (
                    SELECT id, k, row_number() OVER (PARTITION BY k ORDER BY created_at, id) AS n FROM base
                )
                UPDATE atlas_services s
                SET key = CASE WHEN n.n > 1 THEN n.k || '-' || n.n ELSE n.k END
                FROM numbered n
                WHERE n.id = s.id;
            ");
            // A suffix can collide with another service's own name slug; the later row takes its id instead.
            migrationBuilder.Sql(@"
                UPDATE atlas_services SET key = key || '-' || left(id::text, 8)
                WHERE id IN (
                    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY key ORDER BY created_at, id) AS n FROM atlas_services) x
                    WHERE x.n > 1);
            ");

            // Engine: by kind (table 1.2); anything not listed is an application.
            migrationBuilder.Sql(@"
                UPDATE atlas_services SET engine = CASE kind
                    WHEN 'package' THEN 'code'
                    WHEN 'pipeline' THEN 'delivery' WHEN 'host' THEN 'delivery'
                    WHEN 'domain' THEN 'infra' WHEN 'dns' THEN 'infra' WHEN 'cdn' THEN 'infra'
                    WHEN 'edge' THEN 'infra' WHEN 'certificate' THEN 'infra' WHEN 'external' THEN 'infra'
                    WHEN 'agent' THEN 'automation' WHEN 'cron' THEN 'automation' WHEN 'webhook' THEN 'automation' WHEN 'integration' THEN 'automation'
                    WHEN 'payment' THEN 'business' WHEN 'fiscal' THEN 'business'
                    WHEN 'site' THEN 'marketing' WHEN 'seo' THEN 'marketing' WHEN 'analytics' THEN 'marketing'
                    WHEN 'monitor' THEN 'monitoring' WHEN 'email' THEN 'monitoring'
                    WHEN 'credential' THEN 'security' WHEN 'vault' THEN 'security'
                    ELSE 'app' END
                WHERE engine IS NULL;
            ");

            // Verification: a confirmation by Railway or Vercel is theirs; a monitor's is Kuma's.
            migrationBuilder.Sql(@"
                UPDATE atlas_services
                SET verified_at = checked_at,
                    verified_by = CASE WHEN provider IN ('railway', 'vercel') THEN provider ELSE 'kuma' END
                WHERE checked_at IS NOT NULL AND (provider IN ('railway', 'vercel') OR monitor_status IS NOT NULL);
            ");

            // Links: the relation of each old kind; the timestamp that was never there starts at creation.
            migrationBuilder.Sql(@"
                UPDATE atlas_links
                SET relation = CASE kind
                    WHEN 'host' THEN 'hosted_on' WHEN 'dns' THEN 'resolves_dns' WHEN 'storage' THEN 'writes_to'
                    WHEN 'payment' THEN 'billed_through' WHEN 'email' THEN 'sends_email_via' WHEN 'ai' THEN 'calls'
                    WHEN 'login' THEN 'depends_on' WHEN 'measure' THEN 'tracked_by' WHEN 'monitor' THEN 'monitored_by'
                    WHEN 'support' THEN 'reports_to' WHEN 'deploy' THEN 'deploys_to' WHEN 'integration' THEN 'calls'
                    WHEN 'business' THEN 'depends_on'
                    ELSE 'depends_on' END,
                    updated_at = created_at;
            ");

            // A task code on a service becomes a reference to that task.
            migrationBuilder.Sql(@"
                INSERT INTO atlas_refs (id, service_id, kind, code, note, source, created_by, created_at)
                SELECT gen_random_uuid(), s.id, 'task', s.task_code, NULL, 'import', 'Sistema', coalesce(s.created_at, now())
                FROM atlas_services s
                WHERE s.task_code IS NOT NULL AND s.task_code <> '';
            ");

            // Evidence: the import itself (declared), and the collector's confirmation when there was one.
            migrationBuilder.Sql(@"
                INSERT INTO atlas_evidence (id, subject_type, subject_id, source, method, ref, scope, first_seen_at, last_seen_at)
                SELECT gen_random_uuid(), 'service', s.id, 'import', 'manual', 'atlas', 'declared', s.created_at, s.created_at
                FROM atlas_services s;

                INSERT INTO atlas_evidence (id, subject_type, subject_id, source, method, ref, scope, first_seen_at, last_seen_at)
                SELECT gen_random_uuid(), 'service', s.id, 'collector:' || s.verified_by, 'api',
                    left(coalesce(s.provider, '') || ':' || coalesce(s.external_ref, s.monitor_ref, s.name), 300),
                    'runtime', s.checked_at, s.checked_at
                FROM atlas_services s
                WHERE s.verified_at IS NOT NULL;
            ");

            // Now that every row has its values, the columns become required.
            migrationBuilder.AlterColumn<string>(
                name: "key",
                table: "atlas_services",
                type: "character varying(160)",
                maxLength: 160,
                nullable: false);

            migrationBuilder.AlterColumn<string>(
                name: "engine",
                table: "atlas_services",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false);

            migrationBuilder.AlterColumn<string>(
                name: "origin",
                table: "atlas_services",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "declared");

            migrationBuilder.AlterColumn<List<string>>(
                name: "aliases",
                table: "atlas_services",
                type: "text[]",
                nullable: false);

            migrationBuilder.AlterColumn<List<Guid>>(
                name: "service_ids",
                table: "atlas_repos",
                type: "uuid[]",
                nullable: false);

            migrationBuilder.AlterColumn<string>(
                name: "origin",
                table: "atlas_links",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "declared");

            migrationBuilder.AlterColumn<string>(
                name: "relation",
                table: "atlas_links",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "depends_on");

            migrationBuilder.AlterColumn<DateTime>(
                name: "updated_at",
                table: "atlas_links",
                type: "timestamp with time zone",
                nullable: false);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_services_key",
                table: "atlas_services",
                column: "key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_services_retired_at",
                table: "atlas_services",
                column: "retired_at");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_links_from_service_id_to_service_id_relation",
                table: "atlas_links",
                columns: new[] { "from_service_id", "to_service_id", "relation" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_changes_at",
                table: "atlas_changes",
                column: "at");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_changes_entity_type_entity_id",
                table: "atlas_changes",
                columns: new[] { "entity_type", "entity_id" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_changes_product_id_at",
                table: "atlas_changes",
                columns: new[] { "product_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_changesets_idempotency_key",
                table: "atlas_changesets",
                column: "idempotency_key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_changesets_product_id_received_at",
                table: "atlas_changesets",
                columns: new[] { "product_id", "received_at" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_changesets_repo_id_received_at",
                table: "atlas_changesets",
                columns: new[] { "repo_id", "received_at" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_events_at",
                table: "atlas_events",
                column: "at");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_events_product_id_at",
                table: "atlas_events",
                columns: new[] { "product_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_events_repo_id_at",
                table: "atlas_events",
                columns: new[] { "repo_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_events_service_id_at",
                table: "atlas_events",
                columns: new[] { "service_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_events_source_external_id",
                table: "atlas_events",
                columns: new[] { "source", "external_id" },
                unique: true,
                filter: "external_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_evidence_source",
                table: "atlas_evidence",
                column: "source");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_evidence_subject_id",
                table: "atlas_evidence",
                column: "subject_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_evidence_subject_type_subject_id_source_ref",
                table: "atlas_evidence",
                columns: new[] { "subject_type", "subject_id", "source", "ref" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_refs_service_id_kind_code",
                table: "atlas_refs",
                columns: new[] { "service_id", "kind", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_snapshots_taken_at",
                table: "atlas_snapshots",
                column: "taken_at");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "atlas_changes");

            migrationBuilder.DropTable(
                name: "atlas_changesets");

            migrationBuilder.DropTable(
                name: "atlas_events");

            migrationBuilder.DropTable(
                name: "atlas_evidence");

            migrationBuilder.DropTable(
                name: "atlas_refs");

            migrationBuilder.DropTable(
                name: "atlas_snapshots");

            migrationBuilder.DropTable(
                name: "atlas_sources");

            migrationBuilder.DropIndex(
                name: "ix_atlas_services_key",
                table: "atlas_services");

            migrationBuilder.DropIndex(
                name: "ix_atlas_services_retired_at",
                table: "atlas_services");

            migrationBuilder.DropIndex(
                name: "ix_atlas_links_from_service_id_to_service_id_relation",
                table: "atlas_links");

            migrationBuilder.DropColumn(
                name: "aliases",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "engine",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "key",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "missing_since",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "origin",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "removal_reported_at",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "retired_at",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "retired_reason",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "signature",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "verified_at",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "verified_by",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "xmin",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "default_branch",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "external_id",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "last_deployed_sha",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "last_scan_hash",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "last_sync_at",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "last_sync_scope",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "last_sync_sha",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "open_pull_requests",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "retired_at",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "role",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "service_ids",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "stack",
                table: "atlas_repos");

            migrationBuilder.DropColumn(
                name: "origin",
                table: "atlas_links");

            migrationBuilder.DropColumn(
                name: "relation",
                table: "atlas_links");

            migrationBuilder.DropColumn(
                name: "retired_at",
                table: "atlas_links");

            migrationBuilder.DropColumn(
                name: "updated_at",
                table: "atlas_links");

            migrationBuilder.DropColumn(
                name: "verified_at",
                table: "atlas_links");

            migrationBuilder.DropColumn(
                name: "xmin",
                table: "atlas_links");

            migrationBuilder.DropColumn(
                name: "branch",
                table: "atlas_activities");

            migrationBuilder.DropColumn(
                name: "head_sha",
                table: "atlas_activities");

            migrationBuilder.DropColumn(
                name: "last_sync_at",
                table: "atlas_activities");

            migrationBuilder.DropColumn(
                name: "repo",
                table: "atlas_activities");

            migrationBuilder.DropColumn(
                name: "tool",
                table: "atlas_activities");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_links_from_service_id_to_service_id",
                table: "atlas_links",
                columns: new[] { "from_service_id", "to_service_id" },
                unique: true);
        }
    }
}
