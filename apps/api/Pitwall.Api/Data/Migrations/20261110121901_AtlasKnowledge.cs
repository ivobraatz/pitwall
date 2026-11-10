using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pitwall.Data.Migrations
{
    /// <inheritdoc />
    public partial class AtlasKnowledge : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "condition",
                table: "atlas_services",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "ok");

            migrationBuilder.AddColumn<string>(
                name: "facts",
                table: "atlas_services",
                type: "jsonb",
                nullable: true,
                defaultValueSql: "'[]'::jsonb");

            migrationBuilder.AddColumn<string>(
                name: "group",
                table: "atlas_services",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "impact",
                table: "atlas_services",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "items",
                table: "atlas_services",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<string>(
                name: "owner",
                table: "atlas_services",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "task_code",
                table: "atlas_services",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "atlas_links",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "planned",
                table: "atlas_links",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "atlas_processes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    position = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    stages = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_processes", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_processes_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "atlas_steps",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    process_id = table.Column<Guid>(type: "uuid", nullable: false),
                    slug = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    stage = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    status = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    owner = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    today = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ideal = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    next = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    task_code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    impact = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    service_ids = table.Column<List<Guid>>(type: "uuid[]", nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_atlas_steps", x => x.id);
                    table.ForeignKey(
                        name: "fk_atlas_steps_atlas_processes_process_id",
                        column: x => x.process_id,
                        principalTable: "atlas_processes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_atlas_steps_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_atlas_processes_product_id",
                table: "atlas_processes",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_processes_slug",
                table: "atlas_processes",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_steps_process_id_slug",
                table: "atlas_steps",
                columns: new[] { "process_id", "slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_atlas_steps_product_id",
                table: "atlas_steps",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_atlas_steps_status",
                table: "atlas_steps",
                column: "status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "atlas_steps");

            migrationBuilder.DropTable(
                name: "atlas_processes");

            migrationBuilder.DropColumn(
                name: "condition",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "facts",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "group",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "impact",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "items",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "owner",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "task_code",
                table: "atlas_services");

            migrationBuilder.DropColumn(
                name: "kind",
                table: "atlas_links");

            migrationBuilder.DropColumn(
                name: "planned",
                table: "atlas_links");
        }
    }
}
