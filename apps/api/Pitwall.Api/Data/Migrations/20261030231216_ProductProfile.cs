using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Pitwall.Data.Migrations
{
    /// <inheritdoc />
    public partial class ProductProfile : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "color",
                table: "products",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "logo_content_type",
                table: "products",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "logo_updated_at",
                table: "products",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "products",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "website_url",
                table: "products",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_products_owner_id",
                table: "products",
                column: "owner_id");

            migrationBuilder.AddForeignKey(
                name: "fk_products_staff_owner_id",
                table: "products",
                column: "owner_id",
                principalTable: "staff",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_products_staff_owner_id",
                table: "products");

            migrationBuilder.DropIndex(
                name: "ix_products_owner_id",
                table: "products");

            migrationBuilder.DropColumn(
                name: "color",
                table: "products");

            migrationBuilder.DropColumn(
                name: "logo_content_type",
                table: "products");

            migrationBuilder.DropColumn(
                name: "logo_updated_at",
                table: "products");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "products");

            migrationBuilder.DropColumn(
                name: "website_url",
                table: "products");
        }
    }
}
