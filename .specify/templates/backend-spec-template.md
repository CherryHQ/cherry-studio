# Backend Specification: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE]
**Input**: data-model.md, api-spec.md (if exists), research.md, spec.md

<!--
  GENERATION CONDITION:
  Only generate this file when ANY of these are true:
  - Project Type contains: web-service, api, saas, web-app (with backend)
  - Project structure selects Option 2 (Web application) with backend/
  - Project structure selects Option 3 (Mobile + API) with api/
  - Primary Dependencies include a server framework (FastAPI, Express, NestJS, Django, Rails, Spring, etc.)
  - Feature requires server-side business logic, background processing, or data orchestration
  
  SKIP this file when:
  - Project Type is: library, cli, compiler, build-tool, script
  - Project is frontend-only (SPA consuming external API with no custom backend)
  - Project is a simple CRUD with no business logic beyond data-model.md entities
    (in that case, data-model.md + api-spec.md are sufficient)
-->

## Overview

[Brief description of what the backend does, its role in the system, and key responsibilities]

## Technology Stack

**Runtime**: [e.g., Node.js 20, Python 3.12, Go 1.22, or extracted from Technical Context]
**Framework**: [e.g., FastAPI, Express, NestJS, Django, Spring Boot]
**ORM / Data Access**: [e.g., Drizzle, Prisma, SQLAlchemy, TypeORM, raw SQL]
**Database**: [from Technical Context Storage field]
**Cache**: [e.g., Redis, in-memory, none]
**Queue / Worker**: [e.g., BullMQ, Celery, SQS, none]
**Package Manager**: [e.g., pnpm, pip, go mod]

## Service Architecture

<!--
  ACTION REQUIRED: Define the service layer. Services encapsulate business logic
  and sit between the API/controller layer and the data access layer.
  
  Derive services from:
  - User stories in spec.md (each story often maps to 1+ services)
  - Entities in data-model.md (domain services per aggregate)
  - Complex operations that span multiple entities
-->

### Service Map

| Service | Responsibility | Dependencies | User Story |
|---------|---------------|--------------|------------|
| [e.g., AuthService] | [User registration, login, token management] | [UserRepository, TokenService] | US1 |
| [e.g., OrderService] | [Order creation, validation, state transitions] | [OrderRepository, PaymentGateway, InventoryService] | US2 |
| [e.g., NotificationService] | [Email/push dispatch, template rendering] | [EmailProvider, PushProvider] | US1, US2 |

### Service Detail: [Service 1]

**Purpose**: [What this service does]
**Methods**:
- `[methodName](params)` → [return type] — [what it does]
- `[methodName](params)` → [return type] — [what it does]

**Business Rules**:
- [Rule 1: e.g., "Orders cannot be cancelled after shipment"]
- [Rule 2: e.g., "User email must be verified before first purchase"]

**Error Cases**:
- [Condition] → [Error type and handling]

---

### Service Detail: [Service 2]

[Same structure as above]

---

[Add more services as needed]

## Middleware Pipeline

<!--
  ACTION REQUIRED: Define the middleware/interceptor stack in execution order.
  Only include middleware relevant to this feature.
-->

| Order | Middleware | Purpose | Applies To |
|-------|-----------|---------|------------|
| 1 | Request ID | Attach unique ID for tracing | All routes |
| 2 | CORS | Cross-origin policy | All routes |
| 3 | Rate Limiter | Throttle requests | Public routes |
| 4 | Auth | Validate token, attach user context | Protected routes |
| 5 | Validation | Request body/query schema validation | Routes with input |
| 6 | Error Handler | Catch + format errors to standard response | All routes (last) |

## Background Jobs / Workers

<!--
  SKIP this section if the project has no async/deferred processing.
  
  Generate this section when:
  - Feature requires email sending, report generation, data sync
  - Operations are too slow for synchronous API response
  - Scheduled/recurring tasks are needed (cron-like)
-->

| Job | Trigger | Queue | Priority | Retry | Description |
|-----|---------|-------|----------|-------|-------------|
| [e.g., SendWelcomeEmail] | User registration | `email` | Normal | 3× with backoff | [Send onboarding email after signup] |
| [e.g., GenerateReport] | API request / cron | `reports` | Low | 1× | [Build PDF report, store in S3, notify user] |
| [e.g., SyncInventory] | Cron (every 15min) | `sync` | High | 5× | [Pull latest stock from warehouse API] |

**Queue System**: [e.g., BullMQ + Redis, Celery + RabbitMQ, SQS, or in-process]
**Dead Letter Queue**: [Yes — after max retries / No]
**Monitoring**: [e.g., Bull Board UI, Flower, CloudWatch]

## Caching Strategy

<!--
  SKIP this section if the project needs no caching.
  
  Generate this section when:
  - Performance Goals specify response time targets
  - Data is read-heavy with infrequent updates
  - External API calls need to be minimized
-->

| Cache Key Pattern | Data | TTL | Invalidation | Storage |
|-------------------|------|-----|-------------|---------|
| `user:{id}` | User profile | 5min | On update | Redis |
| `config:global` | App configuration | 1hr | On admin change | In-memory |
| `search:{hash}` | Search results | 10min | Time-based | Redis |

**Cache Strategy**: [Cache-aside / Write-through / Write-behind]
**Stampede Protection**: [Lock-based / probabilistic early expiry / none]

## External Integrations

<!--
  SKIP this section if the backend has no third-party service dependencies.
  
  Generate this section when:
  - Feature requires payment processing, email, SMS, storage, etc.
  - Backend consumes external APIs (not the project's own frontend)
-->

| Service | Purpose | Auth Method | Failure Strategy |
|---------|---------|-------------|-----------------|
| [e.g., Stripe] | Payment processing | API key | Retry + webhook reconciliation |
| [e.g., SendGrid] | Transactional email | API key | Queue with retry |
| [e.g., AWS S3] | File storage | IAM role | Retry with circuit breaker |

**Circuit Breaker**: [Yes — open after N failures, half-open after Xs / No]
**Timeout Policy**: [e.g., 5s default, 30s for file uploads]
**Fallback Behavior**: [e.g., graceful degradation, cached response, error to user]

## Event System

<!--
  SKIP this section if the project uses no internal event/message passing.
  
  Generate this section when:
  - Multiple services need to react to the same action (decoupled)
  - Audit trail / activity log is required
  - Real-time features depend on backend events (WebSocket push)
-->

| Event | Publisher | Subscribers | Payload |
|-------|-----------|------------|---------|
| `user.created` | AuthService | NotificationService, AnalyticsService | `{ userId, email, source }` |
| `order.completed` | OrderService | InventoryService, NotificationService | `{ orderId, items, total }` |

**Event Bus**: [In-process EventEmitter / Redis Pub/Sub / RabbitMQ / Kafka / none]
**Delivery Guarantee**: [At-least-once / at-most-once / exactly-once]

## Logging & Observability

**Logger**: [e.g., Pino, Winston, Python logging, slog]
**Format**: [Structured JSON / text]
**Correlation**: [Request ID propagated through all service calls]
**Log Levels**: [error → warn → info → debug, default: info in prod]

**Key Log Points**:
- Request entry/exit with duration
- Authentication success/failure
- Business rule violations
- External service calls with latency
- Background job start/complete/fail

## Database Access Patterns

<!--
  Cross-references data-model.md for entity definitions.
  This section focuses on HOW the backend accesses data, not WHAT the data is.
-->

**Repository Pattern**: [Yes — one repo per aggregate root / No — direct ORM queries in services]
**Transaction Boundaries**: [e.g., "Order creation wraps item reservation + payment in single transaction"]
**Connection Pooling**: [e.g., max 20 connections, PgBouncer, or framework default]
**Migration Tool**: [e.g., Drizzle Kit, Alembic, Prisma Migrate, Flyway]

## Startup & Shutdown

**Startup Sequence**:
1. Load environment configuration
2. Connect to database (run migrations if configured)
3. Connect to cache (Redis)
4. Start background job workers
5. Register routes and middleware
6. Begin accepting requests

**Graceful Shutdown**:
1. Stop accepting new requests
2. Wait for in-flight requests to complete (timeout: [e.g., 30s])
3. Stop background job workers (finish current job)
4. Close database and cache connections
5. Exit
