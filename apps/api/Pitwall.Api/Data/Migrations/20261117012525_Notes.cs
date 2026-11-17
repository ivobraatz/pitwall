using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pitwall.Data.Migrations
{
    /// <inheritdoc />
    public partial class Notes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "note_folders",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    parent_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    position = table.Column<double>(type: "double precision", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_note_folders", x => x.id);
                    table.ForeignKey(
                        name: "fk_note_folders_note_folders_parent_id",
                        column: x => x.parent_id,
                        principalTable: "note_folders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "notes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    folder_id = table.Column<Guid>(type: "uuid", nullable: true),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "character varying(100000)", maxLength: 100000, nullable: false),
                    stage = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    labels = table.Column<string[]>(type: "text[]", nullable: false),
                    pinned = table.Column<bool>(type: "boolean", nullable: false),
                    source = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    created_by_ref = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    updated_by_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    updated_by_source = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    task_id = table.Column<Guid>(type: "uuid", nullable: true),
                    converted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    archived_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_notes", x => x.id);
                    table.ForeignKey(
                        name: "fk_notes_note_folders_folder_id",
                        column: x => x.folder_id,
                        principalTable: "note_folders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_notes_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_notes_team_tasks_task_id",
                        column: x => x.task_id,
                        principalTable: "team_tasks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "note_revisions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    note_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "character varying(100000)", maxLength: 100000, nullable: false),
                    author_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    source = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_note_revisions", x => x.id);
                    table.ForeignKey(
                        name: "fk_note_revisions_notes_note_id",
                        column: x => x.note_id,
                        principalTable: "notes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_note_folders_parent_id_name",
                table: "note_folders",
                columns: new[] { "parent_id", "name" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "ix_note_revisions_note_id_created_at",
                table: "note_revisions",
                columns: new[] { "note_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_notes_archived_at",
                table: "notes",
                column: "archived_at");

            migrationBuilder.CreateIndex(
                name: "ix_notes_code",
                table: "notes",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_notes_folder_id",
                table: "notes",
                column: "folder_id");

            migrationBuilder.CreateIndex(
                name: "ix_notes_product_id",
                table: "notes",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_notes_task_id",
                table: "notes",
                column: "task_id");

            migrationBuilder.CreateIndex(
                name: "ix_notes_updated_at",
                table: "notes",
                column: "updated_at");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "note_revisions");

            migrationBuilder.DropTable(
                name: "notes");

            migrationBuilder.DropTable(
                name: "note_folders");
        }
    }
}
