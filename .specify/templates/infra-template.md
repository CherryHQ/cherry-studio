# Infrastructure Specification: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE]
**Input**: research.md, plan.md (Technical Context), backend-spec.md (if exists)

<!--
  GENERATION CONDITION:
  Only generate this file when ANY of these are true:
  - Technical Context Deployment Target field is NOT "N/A" or "NEEDS CLARIFICATION"
  - Project Type is: web-service, api, saas, web-app, mobile-app (backend component)
  - Feature requires hosting, deployment, or cloud resources
  - Feature requires CI/CD pipeline setup
  
  SKIP this file when:
  - Project Type is: library, cli, compiler, build-tool, script (distributed as package/binary only)
  - Project is a desktop-only app with no server component
  - Deployment is fully handled by existing infrastructure (document that in plan.md instead)
  - Project is a prototype / local-only tool that won't be deployed
-->

## Overview

[Brief description of the deployment strategy: where it runs, how it's deployed, and key infrastructure decisions]

## Environments

| Environment | Purpose | URL / Access | Deploy Trigger |
|-------------|---------|--------------|---------------|
| Development | Local development | `localhost:[PORT]` | Manual |
| [e.g., Staging] | Pre-production testing | [e.g., `staging.example.com`] | [e.g., Push to `main`] |
| [e.g., Production] | Live users | [e.g., `app.example.com`] | [e.g., Git tag / manual approval] |

### Environment Parity

**Strategy**: [e.g., Docker ensures identical runtime across all envs, or framework-managed]
**Differences**: [Document intentional differences: debug logging in dev, CDN in prod, mock services in staging, etc.]

## Environment Variables & Secrets

<!--
  ACTION REQUIRED: List all environment variables the application needs.
  NEVER put actual secret values here — only variable names and descriptions.
-->

### Application Config

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` / `APP_ENV` | Yes | `development` | Runtime environment |
| `PORT` | No | [e.g., 3000] | Server listen port |
| `DATABASE_URL` | Yes | — | Database connection string |
| `REDIS_URL` | [If caching] | — | Cache connection string |
| `LOG_LEVEL` | No | `info` | Logging verbosity |

### Secrets

| Variable | Required | Source | Description |
|----------|----------|--------|-------------|
| `JWT_SECRET` | [If JWT auth] | [e.g., AWS SSM / Vault / .env] | Token signing key |
| `[PROVIDER]_API_KEY` | [If integration] | [Secret manager] | Third-party API credential |
| `DATABASE_PASSWORD` | Yes | [Secret manager] | Database auth |

**Secret Management**: [e.g., AWS SSM Parameter Store, HashiCorp Vault, Doppler, .env files (dev only), GitHub Secrets (CI)]
**Rotation Policy**: [e.g., rotate quarterly, auto-rotate via provider, or manual]

## Containerization

<!--
  SKIP this section if the project is deployed as a serverless function,
  static site, or platform-managed service (e.g., Vercel, Netlify, Heroku).
-->

### Dockerfile

**Base Image**: [e.g., `node:20-alpine`, `python:3.12-slim`, `golang:1.22-alpine`]
**Multi-stage**: [Yes — build stage + runtime stage / No]
**Final Image Size Target**: [e.g., < 200MB]

**Build Strategy**:
```
Stage 1: Dependencies (cached layer)
  → Copy lock file → Install deps

Stage 2: Build (if compiled/bundled)
  → Copy source → Build artifacts

Stage 3: Runtime (minimal)
  → Copy only runtime deps + artifacts
  → Set non-root user
  → Define healthcheck
  → Set entrypoint
```

### Docker Compose (Development)

**Services**:
| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| app | Build from Dockerfile | [e.g., 3000:3000] | Application |
| db | [e.g., postgres:16-alpine] | [e.g., 5432:5432] | Database |
| cache | [e.g., redis:7-alpine] | [e.g., 6379:6379] | Cache (if needed) |
| [worker] | Same as app | — | Background jobs (if needed) |

**Volumes**: [e.g., `./src:/app/src` for hot reload, `pgdata:/var/lib/postgresql/data` for persistence]

## CI/CD Pipeline

### Pipeline Overview

**Tool**: [e.g., GitHub Actions, GitLab CI, CircleCI, Jenkins, or NEEDS CLARIFICATION]
**Trigger**: [e.g., Push to any branch → CI, Push to main → CD staging, Tag → CD production]

### Pipeline Stages

```
1. Lint & Format Check
   → [e.g., ESLint, Biome, Ruff, clippy]
   → FAIL FAST: block pipeline on lint errors

2. Type Check (if applicable)
   → [e.g., tsc --noEmit, mypy, go vet]

3. Unit Tests
   → [e.g., vitest, pytest, cargo test]
   → Coverage report (threshold: [e.g., 80% or no threshold])

4. Integration Tests (if applicable)
   → Spin up test database / services
   → Run integration suite
   → Tear down

5. Build
   → [e.g., Docker build, npm run build, go build]
   → Cache dependencies between runs

6. Security Scan (if applicable)
   → [e.g., npm audit, trivy container scan, SAST]

7. Deploy to Staging (on main branch)
   → [Deployment method — see Deployment section]
   → Run smoke tests against staging

8. Deploy to Production (on tag / approval)
   → [Deployment method]
   → Run smoke tests
   → Notify team
```

### Caching Strategy

| Cache | Key | Paths | Purpose |
|-------|-----|-------|---------|
| Dependencies | [e.g., `hash(pnpm-lock.yaml)`] | [e.g., `node_modules/`, `.pnpm-store/`] | Skip install on unchanged deps |
| Build | [e.g., `hash(src/)`] | [e.g., `dist/`, `.next/`] | Skip build on unchanged source |
| Docker layers | Built-in | — | Layer caching via buildx |

## Deployment

### Strategy

**Method**: [Choose based on project needs]
- [ ] Container orchestration (Kubernetes, ECS, Cloud Run)
- [ ] Platform-as-a-Service (Vercel, Netlify, Heroku, Railway)
- [ ] Serverless functions (AWS Lambda, Cloudflare Workers)
- [ ] VM / bare metal (EC2, Droplet, VPS)
- [ ] Static hosting + API (S3 + CloudFront + Lambda)
- [ ] Self-hosted Docker Compose

**Provider**: [e.g., AWS, GCP, Azure, Vercel, DigitalOcean, Cloudflare]

### Deployment Process

**Zero-downtime**: [Yes — rolling update / blue-green / canary / No]
**Rollback**: [e.g., redeploy previous container tag, revert git commit, platform instant rollback]
**Health Check**: [e.g., `GET /health` returns 200 with { status: "ok", db: "connected" }]

### Scaling

**Type**: [Horizontal / Vertical / Auto-scaling / Fixed]
**Min Instances**: [e.g., 2 for HA, 1 for cost savings]
**Max Instances**: [e.g., 10, or unlimited with cost ceiling]
**Scale Trigger**: [e.g., CPU > 70%, request queue > 100, or manual]

## Database Operations

### Migrations

**Tool**: [e.g., Drizzle Kit, Alembic, Prisma Migrate, Flyway]
**Strategy**: [e.g., run on deploy before app start, separate migration step, manual]
**Rollback**: [e.g., down migrations, manual SQL, or forward-only]
**CI Check**: [e.g., generate migration → check for drift → fail if schema out of sync]

### Backups

<!--
  SKIP if using a managed database with built-in backups.
-->

**Frequency**: [e.g., daily automated, continuous (point-in-time recovery)]
**Retention**: [e.g., 30 days]
**Method**: [e.g., managed provider snapshots, pg_dump cron, WAL archiving]
**Restore Test**: [e.g., monthly restore drill, or never tested]

## Monitoring & Alerting

<!--
  SKIP this section for prototypes or internal tools that don't need monitoring.
-->

### Health Monitoring

**Uptime Check**: [e.g., Pingdom, UptimeRobot, cloud provider health check]
**Health Endpoint**: [e.g., `GET /health` — checks DB, cache, critical dependencies]
**Status Page**: [e.g., statuspage.io, Instatus, or none]

### Application Monitoring

**APM**: [e.g., Datadog, New Relic, Sentry Performance, OpenTelemetry, or none]
**Error Tracking**: [e.g., Sentry, Bugsnag, Rollbar, or application logs only]
**Metrics**: [e.g., request latency, error rate, queue depth, DB connection pool]

### Alerting

| Alert | Condition | Severity | Channel |
|-------|-----------|----------|---------|
| App down | Health check fails 3× | Critical | [e.g., PagerDuty, Slack] |
| High error rate | > 5% 5xx in 5min | High | [e.g., Slack] |
| High latency | p95 > [threshold] | Medium | [e.g., Slack] |
| Disk usage | > 80% | Medium | [e.g., Email] |

## Domain & Networking

<!--
  SKIP if local-only or the project doesn't need custom domain setup.
-->

**Domain**: [e.g., example.com, or TBD]
**DNS Provider**: [e.g., Cloudflare, Route53, Namecheap]
**CDN**: [e.g., Cloudflare, CloudFront, Fastly, or none]
**SSL Certificate**: [e.g., auto via Let's Encrypt, Cloudflare managed, ACM]

### Load Balancing

<!--
  SKIP if single-instance or platform-managed.
-->

**Type**: [e.g., ALB, Nginx, Traefik, platform-managed]
**Health Check Path**: [e.g., `/health`]
**Algorithm**: [e.g., round-robin, least connections]
