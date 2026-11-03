using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pitwall.Data.Migrations
{
    /// <inheritdoc />
    public partial class TeamTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "staff_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    staff_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    prefix = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    scopes = table.Column<string[]>(type: "text[]", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_used_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_staff_tokens", x => x.id);
                    table.ForeignKey(
                        name: "fk_staff_tokens_staff_staff_user_id",
                        column: x => x.staff_user_id,
                        principalTable: "staff",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "team_tasks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: true),
                    code = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    position = table.Column<double>(type: "double precision", nullable: false),
                    priority = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    labels = table.Column<string[]>(type: "text[]", nullable: false),
                    due_date = table.Column<DateOnly>(type: "date", nullable: true),
                    assignee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    created_by_ref = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_by_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    blocked_note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    done_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    archived_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    checklist = table.Column<string>(type: "jsonb", nullable: true),
                    links = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_team_tasks", x => x.id);
                    table.ForeignKey(
                        name: "fk_team_tasks_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_team_tasks_staff_assignee_id",
                        column: x => x.assignee_id,
                        principalTable: "staff",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "team_task_comments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_ref = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    author_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    source = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    body = table.Column<string>(type: "character varying(10000)", maxLength: 10000, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_team_task_comments", x => x.id);
                    table.ForeignKey(
                        name: "fk_team_task_comments_team_tasks_task_id",
                        column: x => x.task_id,
                        principalTable: "team_tasks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "team_task_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    task_id = table.Column<Guid>(type: "uuid", nullable: false),
                    actor_ref = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    actor_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    source = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    data = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_team_task_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_team_task_events_team_tasks_task_id",
                        column: x => x.task_id,
                        principalTable: "team_tasks",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_staff_tokens_hash",
                table: "staff_tokens",
                column: "hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_staff_tokens_staff_user_id",
                table: "staff_tokens",
                column: "staff_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_team_task_comments_task_id_created_at",
                table: "team_task_comments",
                columns: new[] { "task_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_team_task_events_task_id_created_at",
                table: "team_task_events",
                columns: new[] { "task_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_team_tasks_archived_at",
                table: "team_tasks",
                column: "archived_at");

            migrationBuilder.CreateIndex(
                name: "ix_team_tasks_assignee_id",
                table: "team_tasks",
                column: "assignee_id");

            migrationBuilder.CreateIndex(
                name: "ix_team_tasks_code",
                table: "team_tasks",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_team_tasks_product_id",
                table: "team_tasks",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "ix_team_tasks_status_position",
                table: "team_tasks",
                columns: new[] { "status", "position" },
                filter: "archived_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_team_tasks_updated_at",
                table: "team_tasks",
                column: "updated_at");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "staff_tokens");

            migrationBuilder.DropTable(
                name: "team_task_comments");

            migrationBuilder.DropTable(
                name: "team_task_events");

            migrationBuilder.DropTable(
                name: "team_tasks");
        }
    }
}
