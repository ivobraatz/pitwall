# Pitwall API. Build from the repository root:  docker build -f apps/api/Dockerfile .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY apps/api/Pitwall.Api/Pitwall.Api.csproj apps/api/Pitwall.Api/
RUN dotnet restore apps/api/Pitwall.Api/Pitwall.Api.csproj
COPY apps/api/Pitwall.Api/ apps/api/Pitwall.Api/
RUN dotnet publish apps/api/Pitwall.Api/Pitwall.Api.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
# Npgsql probes for GSSAPI at connect time; without the library it logs an error on every pool start.
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080 \
    Storage__Path=/data/blobs
VOLUME /data
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "Pitwall.Api.dll"]
