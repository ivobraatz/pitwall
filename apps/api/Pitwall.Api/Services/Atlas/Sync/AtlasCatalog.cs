namespace Pitwall.Services.Atlas.Sync;

/// <summary>
/// What a repository can depend on that the map knows by name (contract 5.3). A dependency in a
/// manifest, or a variable prefix in an example env file, is enough to find it.
/// </summary>
public sealed record CatalogEntry(
    string Signature, string Name, string Kind, string Relation, bool Shared,
    string[] Npm, string[] NuGet, string[] Pip, string[] EnvPrefixes);

public static class AtlasCatalog
{
    private static readonly string[] None = [];

    public static readonly IReadOnlyList<CatalogEntry> All =
    [
        new("stripe", "Stripe", "payment", "billed_through", true, ["stripe", "@stripe/stripe-js"], ["Stripe.net"], ["stripe"], ["STRIPE_"]),
        new("mercadopago", "Mercado Pago", "payment", "billed_through", true, ["mercadopago"], ["mercadopago-sdk"], ["mercadopago"], ["MERCADOPAGO_", "MP_ACCESS"]),
        new("asaas", "Asaas", "payment", "billed_through", true, None, None, None, ["ASAAS_"]),
        new("pagarme", "Pagar.me", "payment", "billed_through", true, ["pagarme"], None, None, ["PAGARME_"]),
        new("resend", "Resend", "email", "sends_email_via", true, ["resend"], ["Resend"], ["resend"], ["RESEND_"]),
        new("sendgrid", "SendGrid", "email", "sends_email_via", true, ["@sendgrid/mail"], ["SendGrid"], ["sendgrid"], ["SENDGRID_"]),
        new("postmark", "Postmark", "email", "sends_email_via", true, ["postmark"], ["Postmark"], None, ["POSTMARK_"]),
        new("smtp", "SMTP", "email", "sends_email_via", true, ["nodemailer"], ["MailKit"], None, ["SMTP_"]),
        new("anthropic", "Anthropic", "integration", "calls", true, ["@anthropic-ai/sdk"], ["Anthropic"], ["anthropic"], ["ANTHROPIC_"]),
        new("openai", "OpenAI", "integration", "calls", true, ["openai"], ["OpenAI"], ["openai"], ["OPENAI_"]),
        new("gemini", "Google Gemini", "integration", "calls", true, ["@google/genai", "@google/generative-ai"], None, ["google-genai"], ["GEMINI_", "GOOGLE_AI_"]),
        new("postgres", "Postgres", "database", "writes_to", false, ["pg", "postgres", "@neondatabase/serverless"],
            ["Npgsql", "Npgsql.EntityFrameworkCore.PostgreSQL"], ["psycopg", "psycopg2", "psycopg2-binary", "asyncpg"], ["DATABASE_URL", "POSTGRES_", "PG"]),
        new("mysql", "MySQL", "database", "writes_to", false, ["mysql2"], ["MySqlConnector", "Pomelo.EntityFrameworkCore.MySql"], ["mysqlclient", "pymysql"], ["MYSQL_"]),
        new("mongodb", "MongoDB", "database", "writes_to", false, ["mongodb", "mongoose"], ["MongoDB.Driver"], ["pymongo"], ["MONGO"]),
        new("redis", "Redis", "cache", "writes_to", false, ["ioredis", "redis", "@upstash/redis"], ["StackExchange.Redis"], ["redis"], ["REDIS_"]),
        new("bullmq", "Fila (BullMQ)", "queue", "writes_to", false, ["bullmq", "bull"], None, None, None),
        new("hangfire", "Fila (Hangfire)", "queue", "writes_to", false, None, ["Hangfire.Core", "Hangfire.AspNetCore"], None, None),
        new("rabbitmq", "RabbitMQ", "queue", "writes_to", false, ["amqplib"], ["RabbitMQ.Client"], ["pika"], ["RABBITMQ_", "AMQP_"]),
        new("s3", "Armazenamento S3", "storage", "writes_to", false, ["@aws-sdk/client-s3", "minio"], ["AWSSDK.S3", "Minio"], ["boto3"], ["S3_", "AWS_S3"]),
        new("r2", "Cloudflare R2", "storage", "writes_to", false, None, None, None, ["R2_"]),
        new("sentry", "Sentry", "monitor", "monitored_by", true, ["@sentry/node", "@sentry/nextjs", "@sentry/react"], ["Sentry.AspNetCore", "Sentry"], ["sentry-sdk"], ["SENTRY_"]),
        new("pitwall", "Pitwall", "monitor", "reports_to", true, ["pitwall-sdk", "@pitwall/sdk"], ["Pitwall.AspNetCore"], None, ["PITWALL_"]),
        new("google-analytics", "Google Analytics", "analytics", "tracked_by", true, ["@next/third-parties", "react-ga4"], None, None, ["NEXT_PUBLIC_GA", "GA_MEASUREMENT", "GA4_"]),
        new("posthog", "PostHog", "analytics", "tracked_by", true, ["posthog-js", "posthog-node"], None, ["posthog"], ["POSTHOG_", "NEXT_PUBLIC_POSTHOG"]),
        new("clarity", "Microsoft Clarity", "analytics", "tracked_by", true, ["@microsoft/clarity"], None, None, ["CLARITY_", "NEXT_PUBLIC_CLARITY"]),
        new("plausible", "Plausible", "analytics", "tracked_by", true, ["next-plausible"], None, None, ["PLAUSIBLE_"]),
        new("search-console", "Google Search Console", "seo", "indexed_by", true, None, None, None, ["GOOGLE_SITE_VERIFICATION", "GSC_"]),
        new("bing-webmaster", "Bing Webmaster", "seo", "indexed_by", true, None, None, None, ["BING_SITE_VERIFICATION", "BING_WEBMASTER"]),
        new("clerk", "Clerk", "integration", "depends_on", true, ["@clerk/nextjs", "@clerk/clerk-sdk-node"], None, None, ["CLERK_"]),
        new("supabase", "Supabase", "integration", "depends_on", true, ["@supabase/supabase-js"], None, ["supabase"], ["SUPABASE_"]),
        new("firebase", "Firebase", "integration", "depends_on", true, ["firebase", "firebase-admin"], ["FirebaseAdmin"], ["firebase-admin"], ["FIREBASE_"]),
        new("twilio", "Twilio", "integration", "calls", true, ["twilio"], ["Twilio"], ["twilio"], ["TWILIO_"]),
    ];

    public static CatalogEntry? BySignature(string signature) => All.FirstOrDefault(e => e.Signature == signature);
}
