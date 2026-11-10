using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pitwall.Data.Migrations
{
    /// <inheritdoc />
    public partial class Atlas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "atlas_discoveries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    external_ref = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    environment = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    first_seen_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    dismissed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_discoveries", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "atlas_environments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_environments", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "atlas_repos",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    full_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    last_run_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    last_run_status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    last_run_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    last_run_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    last_run_sha = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    commits7d = table.Column<int>(type: "integer", nullable: true),
                    runs7d = table.Column<int>(type: "integer", nullable: true),
                    failed_runs7d = table.Column<int>(type: "integer", nullable: true),
                    open_alerts = table.Column<int>(type: "integer", nullable: true),
                    checked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_repos", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_repos_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "atlas_routines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    frequency = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    prompt = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    enabled = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_routines", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_routines_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "atlas_services",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    environment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    provider = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    external_ref = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    monitor_ref = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    monitor_status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    deploy_status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    last_deploy_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    commit_sha = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    checked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_services", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_services_atlas_environments_environment_id",
                        column: x => x.environment_id,
                        principalTable: "atlas_environments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_atlas_services_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "atlas_routine_runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    routine_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    finished_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    summary = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    actor_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    links = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_routine_runs", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_routine_runs_atlas_routines_routine_id",
                        column: x => x.routine_id,
                        principalTable: "atlas_routines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "atlas_activities",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    service_id = table.Column<Guid>(type: "uuid", nullable: true),
                    component = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    result = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    actor_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    source = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    finished_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_activities", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_activities_atlas_services_service_id",
                        column: x => x.service_id,
                        principalTable: "atlas_services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_atlas_activities_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "atlas_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_service_id = table.Column<Guid>(type: "uuid", nullable: false),
                    to_service_id = table.Column<Guid>(type: "uuid", nullable: false),
                    label = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_links", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_links_atlas_services_from_service_id",
                        column: x => x.from_service_id,
                        principalTable: "atlas_services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_atlas_links_atlas_services_to_service_id",
                        column: x => x.to_service_id,
                        principalTable: "atlas_services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_activities_product_id",
                table: "atlas_activities",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_activities_service_id",
                table: "atlas_activities",
                column: "service_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_activities_status_started_at",
                table: "atlas_activities",
                columns: new[] { "status", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_discoveries_source_kind_external_ref",
                table: "atlas_discoveries",
                columns: new[] { "source", "kind", "external_ref" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_environments_slug",
                table: "atlas_environments",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_links_from_service_id_to_service_id",
                table: "atlas_links",
                columns: new[] { "from_service_id", "to_service_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_links_to_service_id",
                table: "atlas_links",
                column: "to_service_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_repos_full_name",
                table: "atlas_repos",
                column: "full_name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_repos_product_id",
                table: "atlas_repos",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_routine_runs_routine_id_started_at",
                table: "atlas_routine_runs",
                columns: new[] { "routine_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_routine_runs_status",
                table: "atlas_routine_runs",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_routines_product_id",
                table: "atlas_routines",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_routines_slug",
                table: "atlas_routines",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_services_environment_id",
                table: "atlas_services",
                column: "environment_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_services_product_id",
                table: "atlas_services",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_services_provider_external_ref",
                table: "atlas_services",
                columns: new[] { "provider", "external_ref" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "atlas_activities");

            migrationBuilder.DropTable(
                name: "atlas_discoveries");

            migrationBuilder.DropTable(
                name: "atlas_links");

            migrationBuilder.DropTable(
                name: "atlas_repos");

            migrationBuilder.DropTable(
                name: "atlas_routine_runs");

            migrationBuilder.DropTable(
                name: "atlas_services");

            migrationBuilder.DropTable(
                name: "atlas_routines");

            migrationBuilder.DropTable(
                name: "atlas_environments");
        }
    }
}
