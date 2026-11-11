using Pitwall.Domain;
using Pitwall.Services.Atlas.Sync;

namespace Pitwall.Tests;

/// <summary>What the manifests of a repository say: stack facts, and one finding per thing it depends on.</summary>
public class AtlasManifestTests
{
    private const string NextPackageJson = """
        {
          "name": "acme-web",
          "packageManager": "pnpm@9.15.0",
          "engines": { "node": ">=22" },
          "dependencies": {
            "next": "^16.4.5",
            "react": "19.2.0",
            "stripe": "^17.0.0",
            "resend": "^4.0.0",
            "@anthropic-ai/sdk": "^0.40.0",
            "pg": "^8.13.0",
            "ioredis": "^5.4.0",
            "@sentry/nextjs": "^9.0.0",
            "pitwall-sdk": "^1.0.0"
          },
          "devDependencies": { "typescript": "^5.6.0" }
        }
        """;

    private const string WebCsproj = """
        <Project Sdk="Microsoft.NET.Sdk.Web">
          <PropertyGroup>
            <TargetFramework>net10.0</TargetFramework>
          </PropertyGroup>
          <ItemGroup>
            <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.0" />
            <PackageReference Include="Stripe.net" Version="48.0.0" />
          </ItemGroup>
        </Project>
        """;

    private const string DeployWorkflow = """
        name: Deploy
        on:
          push:
            branches: [main]
          schedule:
            - cron: '0 3 * * *'
        jobs:
          deploy:
            runs-on: ubuntu-latest
            steps:
              - uses: actions/checkout@v4
              - run: npx -y railway up --service api
        """;

    private const string EdgeWrangler = """
        name = "api-edge"
        routes = ["api.acme.example/*"]

        [triggers]
        crons = ["0 * * * *", "*/5 * * * *"]

        [[r2_buckets]]
        binding = "UPLOADS"
        bucket_name = "acme-uploads"
        """;

    private const string EnvExample = """
        STRIPE_SECRET_KEY=
        STRIPE_WEBHOOK_SECRET=
        DATABASE_URL=
        NEXT_PUBLIC_GA_ID=
        """;

    private static ScanResult Scan(params (string Path, string? Content)[] files) => AtlasManifestParser.Parse(files);

    private static Finding One(ScanResult result, string signature) =>
        result.Findings.Single(f => f.Signature == signature);

    private static string? Fact(ScanResult result, string key) =>
        result.Stack.FirstOrDefault(f => f.Key == key)?.Value;

    [Fact]
    public void Next_app_reads_its_stack_and_every_known_dependency()
    {
        var result = Scan(("package.json", NextPackageJson));

        Assert.Equal("Next.js 16.4.5", Fact(result, "framework"));
        Assert.Contains(result.Stack, f => f.Key == "framework" && f.Value == "React");
        Assert.Equal("Node >=22", Fact(result, "runtime"));
        Assert.Equal("pnpm", Fact(result, "package-manager"));
        Assert.Equal("TypeScript", Fact(result, "language"));

        var stripe = One(result, "stripe");
        Assert.Equal("Stripe", stripe.Name);
        Assert.Equal(AtlasEngines.Business, stripe.Engine);
        Assert.Equal("payment", stripe.Kind);
        Assert.Equal("billed_through", stripe.Relation);
        Assert.True(stripe.Shared);
        Assert.Equal("manifest", stripe.Method);
        Assert.Equal("package.json#dependencies.stripe", stripe.Reference);

        var resend = One(result, "resend");
        Assert.Equal(AtlasEngines.Monitoring, resend.Engine);
        Assert.Equal("sends_email_via", resend.Relation);
        Assert.True(resend.Shared);

        var anthropic = One(result, "anthropic");
        Assert.Equal(AtlasEngines.Automation, anthropic.Engine);
        Assert.Equal("calls", anthropic.Relation);
        Assert.True(anthropic.Shared);

        var postgres = One(result, "postgres");
        Assert.Equal("database", postgres.Kind);
        Assert.Equal(AtlasEngines.App, postgres.Engine);
        Assert.Equal("writes_to", postgres.Relation);
        Assert.False(postgres.Shared);

        var redis = One(result, "redis");
        Assert.Equal("cache", redis.Kind);
        Assert.Equal(AtlasEngines.App, redis.Engine);
        Assert.False(redis.Shared);

        var sentry = One(result, "sentry");
        Assert.Equal(AtlasEngines.Monitoring, sentry.Engine);
        Assert.Equal("monitored_by", sentry.Relation);
        Assert.True(sentry.Shared);

        var pitwall = One(result, "pitwall");
        Assert.Equal("reports_to", pitwall.Relation);
        Assert.True(pitwall.Shared);
        Assert.Equal("package.json#dependencies.pitwall-sdk", pitwall.Reference);
    }

    [Fact]
    public void Broken_package_json_gives_nothing_and_no_error()
    {
        var result = Scan(("package.json", "{ \"dependencies\": { \"stripe\": "));

        Assert.Empty(result.Findings);
        Assert.Empty(result.Stack);
    }

    [Fact]
    public void Web_csproj_gives_aspnet_stack_and_nuget_findings()
    {
        var result = Scan(("src/Acme.Api/Acme.Api.csproj", WebCsproj));

        Assert.Equal("C#", Fact(result, "language"));
        Assert.Equal("ASP.NET Core net10.0", Fact(result, "framework"));
        Assert.Equal(".NET net10.0", Fact(result, "runtime"));
        Assert.Equal("NuGet", Fact(result, "package-manager"));

        var postgres = One(result, "postgres");
        Assert.Equal("src/Acme.Api/Acme.Api.csproj#PackageReference.Npgsql.EntityFrameworkCore.PostgreSQL", postgres.Reference);
        Assert.Equal("writes_to", postgres.Relation);

        var stripe = One(result, "stripe");
        Assert.True(stripe.Shared);
        Assert.Equal("billed_through", stripe.Relation);
    }

    [Fact]
    public void Deploy_workflow_gives_pipeline_schedule_and_host()
    {
        var result = Scan((".github/workflows/deploy.yml", DeployWorkflow));

        Assert.Equal("GitHub Actions (1 workflows)", Fact(result, "ci"));

        var pipeline = One(result, "gh-workflow:deploy.yml");
        Assert.Equal("CI: Deploy", pipeline.Name);
        Assert.Equal("pipeline", pipeline.Kind);
        Assert.Equal(AtlasEngines.Delivery, pipeline.Engine);
        Assert.Equal("triggers", pipeline.Relation);
        Assert.Equal("push, schedule", pipeline.Facts!["Gatilhos"]);
        Assert.Equal(".github/workflows/deploy.yml", pipeline.Facts["Arquivo"]);

        var cron = One(result, "gh-cron:deploy.yml:0");
        Assert.Equal("Agendamento: 0 3 * * *", cron.Name);
        Assert.Equal("cron", cron.Kind);
        Assert.Equal(AtlasEngines.Automation, cron.Engine);
        Assert.Equal("schedules", cron.Relation);
        Assert.Equal("gh-workflow:deploy.yml", cron.ToSignature);

        var railway = One(result, "railway");
        Assert.Equal("Railway", railway.Name);
        Assert.Equal("host", railway.Kind);
        Assert.Equal(AtlasEngines.Delivery, railway.Engine);
        Assert.Equal("deploys_to", railway.Relation);
        Assert.True(railway.Shared);
        Assert.Equal("gh-workflow:deploy.yml", railway.FromSignature);
    }

    [Fact]
    public void Wrangler_gives_worker_crons_and_bucket_bound_to_it()
    {
        var result = Scan(("apps/edge/wrangler.toml", EdgeWrangler));

        var worker = One(result, "cloudflare-worker");
        Assert.Equal("Worker api-edge", worker.Name);
        Assert.Equal("edge", worker.Kind);
        Assert.Equal(AtlasEngines.Infra, worker.Engine);
        Assert.Equal("cloudflare", worker.Provider);
        Assert.Equal("worker:api-edge", worker.ExternalRef);
        Assert.Equal("api.acme.example/*", worker.Facts!["Rotas"]);

        var crons = result.Findings.Where(f => f.Kind == "cron").OrderBy(f => f.Name, StringComparer.Ordinal).ToList();
        Assert.Equal(2, crons.Count);
        Assert.All(crons, c =>
        {
            Assert.Equal("schedules", c.Relation);
            Assert.Equal("cloudflare-worker", c.ToSignature);
        });

        var bucket = result.Findings.Single(f => f.Name == "R2 acme-uploads");
        Assert.Equal("storage", bucket.Kind);
        Assert.Equal(AtlasEngines.App, bucket.Engine);
        Assert.Equal("writes_to", bucket.Relation);
        Assert.Equal("cloudflare-worker", bucket.FromSignature);
        Assert.Equal("r2:acme-uploads", bucket.ExternalRef);
    }

    [Fact]
    public void Vercel_config_gives_host_and_a_cron_on_the_repository()
    {
        var result = Scan(("vercel.json", """{"crons":[{"path":"/api/cron/digest","schedule":"0 8 * * 1"}]}"""));

        var host = One(result, "vercel");
        Assert.Equal("Vercel", host.Name);
        Assert.True(host.Shared);
        Assert.Equal("deploys_to", host.Relation);

        var cron = result.Findings.Single(f => f.Kind == "cron");
        Assert.Equal("Agendamento /api/cron/digest", cron.Name);
        Assert.True(cron.TargetsRepo);
        Assert.Equal("schedules", cron.Relation);
        Assert.Equal("0 8 * * 1", cron.Facts!["Expressão"]);
    }

    [Fact]
    public void Example_env_gives_services_credentials_and_webhook_but_never_values()
    {
        var kept = AtlasSanitizer.Transform(".env.example", EnvExample).Content;
        var result = Scan((".env.example", kept));

        var stripe = result.Findings.Where(f => f.Signature == "stripe").ToList();
        Assert.Contains(stripe, f => f.Method == "env-example" && f.Reference == ".env.example#STRIPE_SECRET_KEY");
        Assert.Contains(stripe, f => f.Reference == ".env.example#STRIPE_WEBHOOK_SECRET");
        Assert.Equal("billed_through", stripe[0].Relation);

        var postgres = One(result, "postgres");
        Assert.Equal(".env.example#DATABASE_URL", postgres.Reference);

        var analytics = One(result, "google-analytics");
        Assert.Equal("tracked_by", analytics.Relation);
        Assert.Equal(".env.example#NEXT_PUBLIC_GA_ID", analytics.Reference);

        var webhook = One(result, "webhook:STRIPE_WEBHOOK_SECRET");
        Assert.Equal("Webhook STRIPE", webhook.Name);
        Assert.Equal("triggers", webhook.Relation);
        Assert.Equal("stripe", webhook.FromSignature);

        var credential = One(result, "env:STRIPE_SECRET_KEY");
        Assert.Equal("credential", credential.Kind);
        Assert.Equal(AtlasEngines.Security, credential.Engine);
        Assert.Equal("uses_credential_ref", credential.Relation);
        Assert.Equal("stripe", credential.FromSignature);
        Assert.Equal("nunca guardado no Atlas", credential.Facts!["Valor"]);

        Assert.DoesNotContain(result.Findings, f => f.Signature == "env:DATABASE_URL" || f.Signature == "env:NEXT_PUBLIC_GA_ID");
    }

    [Fact]
    public void Robots_file_gives_one_seo_node_with_its_facts()
    {
        var result = Scan(("public/robots.txt", "User-agent: *\nAllow: /\n"));

        var seo = One(result, "seo-files");
        Assert.Equal("seo", seo.Kind);
        Assert.Equal(AtlasEngines.Marketing, seo.Engine);
        Assert.Equal("sim", seo.Facts!["robots"]);
        Assert.Equal("não", seo.Facts["sitemap"]);
    }

    [Fact]
    public void Dockerfile_gives_container_and_runtime()
    {
        var result = Scan(("Dockerfile", "FROM --platform=linux/amd64 node:22-alpine AS build\nRUN npm ci\n"));

        Assert.Equal("node:22-alpine", Fact(result, "container"));
        Assert.Equal("Node 22", Fact(result, "runtime"));
    }

    [Fact]
    public void Presence_only_lockfile_says_the_package_manager_without_content()
    {
        var result = Scan(("package.json", NextPackageJson), ("pnpm-lock.yaml", null));

        Assert.Equal("pnpm", Fact(result, "package-manager"));
    }

    [Fact]
    public void The_same_dependency_read_from_two_places_is_two_evidences_of_one_finding()
    {
        var result = Scan(("package.json", NextPackageJson), (".env.example", "STRIPE_SECRET_KEY=\n"));

        var stripe = result.Findings.Where(f => f.Signature == "stripe").ToList();
        Assert.Equal(2, stripe.Count);
        Assert.Equal(2, stripe.Select(f => f.Reference).Distinct().Count());
    }
}
