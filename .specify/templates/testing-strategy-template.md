# Testing Strategy: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE]
**Input**: spec.md (acceptance scenarios), plan.md (Technical Context), data-model.md, api-spec.md (if exists), constitution.md

<!--
  GENERATION CONDITION:
  Only generate this file when ANY of these are true:
  - Constitution mandates testing (e.g., "Test-First", "TDD mandatory", "lint, test, and format before completion")
  - Feature spec includes test-related acceptance criteria
  - Technical Context Testing field is filled (not "N/A" or "NEEDS CLARIFICATION")
  - Project Type is: web-service, api, saas (where reliability is critical)
  - Stakeholders explicitly request a testing plan
  
  SKIP this file when:
  - Project is a prototype, spike, or proof-of-concept where testing is deferred
  - Project is a one-off script or utility with no long-term maintenance
  - Constitution explicitly states testing is optional AND spec has no test requirements
  - Tasks template already has sufficient test guidance for this feature's complexity
-->

## Overview

[Brief description of the testing approach: what's being tested, why, and the overall philosophy (TDD, test-after, behavior-driven, etc.)]

## Testing Framework & Tools

<!--
  Extract from Technical Context Testing field and research.md.
-->

| Tool | Purpose | Config |
|------|---------|--------|
| [e.g., Vitest] | Unit + integration tests | [e.g., `vitest.config.ts`] |
| [e.g., Playwright] | End-to-end tests | [e.g., `playwright.config.ts`] |
| [e.g., Supertest] | API integration tests | [Inline with test framework] |
| [e.g., Testing Library] | Component tests (frontend) | [With framework adapter] |
| [e.g., Faker.js / Factory Boy] | Test data generation | [Inline] |
| [e.g., MSW / VCR] | External API mocking | [e.g., `src/mocks/handlers.ts`] |

**Test Runner Command**: [e.g., `pnpm test`, `pytest`, `cargo test`]
**Watch Mode**: [e.g., `pnpm test:watch`, `pytest-watch`]
**CI Command**: [e.g., `pnpm test -- --coverage --reporter=json`]

## Test Pyramid

<!--
  Define the balance between test types for this feature.
  The pyramid shape (many unit, fewer integration, fewest e2e) is a starting point;
  adjust based on project type and risk areas.
-->

```
        ┌──────┐
        │  E2E │  ← Few: critical user journeys only
       ┌┴──────┴┐
       │ Integr.│  ← Moderate: service boundaries, API contracts, DB queries
      ┌┴────────┴┐
      │   Unit   │  ← Many: business logic, utilities, pure functions
      └──────────┘
```

| Layer | Scope | Approximate Ratio | Speed Target |
|-------|-------|-------------------|--------------|
| Unit | Single function/class, no I/O | [e.g., 70%] | < 50ms each |
| Integration | Service + database, API endpoints, component + API | [e.g., 25%] | < 2s each |
| E2E | Full user journey through real UI/API | [e.g., 5%] | < 30s each |

## What to Test (by Layer)

### Unit Tests

<!--
  ACTION REQUIRED: Map to actual code from data-model.md and backend-spec.md.
  Focus on business logic, not framework glue.
-->

**Always unit test**:
- Business rule functions (validation, calculation, state transitions)
- Data transformation / mapping functions
- Utility functions and helpers
- Custom error classes and error handling logic
- Configuration parsing / validation

**Skip unit tests for**:
- Framework boilerplate (route definitions, middleware registration)
- Simple getter/setter with no logic
- Third-party library wrappers with no custom logic
- Database queries (covered by integration tests)

**Example test targets for this feature**:
| Target | What to Assert | Priority |
|--------|---------------|----------|
| [e.g., `OrderService.calculateTotal()`] | [Correct total with discounts, tax, edge cases] | High |
| [e.g., `validateEmail()`] | [Valid/invalid formats, edge cases] | Medium |
| [e.g., `UserModel.canPerformAction()`] | [Permission checks per role] | High |

### Integration Tests

<!--
  ACTION REQUIRED: Identify integration boundaries from backend-spec.md and api-spec.md.
-->

**Always integration test**:
- API endpoints (request → response cycle with real middleware)
- Database operations (queries, migrations, constraints)
- Service-to-service interactions within the app
- Authentication / authorization flows end-to-end
- Background job execution (enqueue → process → side effects)

**Test environment needs**:
| Dependency | Test Strategy |
|------------|---------------|
| Database | [e.g., test database per run, transactions rolled back, or in-memory SQLite] |
| Cache (Redis) | [e.g., real Redis in Docker, or mock] |
| External APIs | [e.g., MSW handlers / VCR cassettes / stub server] |
| File storage | [e.g., local filesystem / tmp directory / mock S3] |
| Email | [e.g., captured in-memory, Ethereal, or mock] |

**Example test targets for this feature**:
| Target | What to Assert | Priority |
|--------|---------------|----------|
| [e.g., `POST /api/orders`] | [Creates order in DB, returns 201, validates input] | High |
| [e.g., `Auth flow`] | [Login → receive token → access protected route → 200] | High |
| [e.g., `OrderService + PaymentGateway`] | [Creates order, charges payment, handles failure] | Medium |

### End-to-End Tests

<!--
  SKIP this section if the project has no user-facing interface (API-only projects
  can rely on API integration tests instead of E2E).
-->

**Always E2E test**:
- Critical user journeys (the "happy path" that MUST work)
- Payment / checkout flows (if applicable)
- Authentication full cycle (signup → verify → login → use app)

**Map to user stories from spec.md**:
| User Story | E2E Test Scenario | Priority |
|------------|-------------------|----------|
| US1 (P1) | [e.g., User signs up → lands on dashboard → creates first item] | Must have |
| US2 (P2) | [e.g., User searches → filters → selects → completes action] | Should have |
| US3 (P3) | [e.g., Admin changes settings → effect visible to users] | Nice to have |

### Contract Tests

<!--
  SKIP this section if the project has no API consumers or microservice boundaries.
  
  Generate this section when:
  - api-spec.md exists and has external consumers
  - Project is a microservice that other services depend on
  - Project provides a public SDK or client library
-->

**What to verify**:
- Response schema matches api-spec.md definitions
- Error response format is consistent
- Required fields are always present
- Breaking changes are caught before deployment

**Tool**: [e.g., Pact, Schemathesis, custom schema validator, or inline with integration tests]

## Test Data Management

### Strategy

**Approach**: [Choose based on project needs]
- [ ] Factories (programmatic data generation per test)
- [ ] Fixtures (static JSON/YAML files loaded before tests)
- [ ] Database seeding (pre-populate with known dataset)
- [ ] Combination (factories for unit, fixtures for integration)

### Factory Examples

<!--
  ACTION REQUIRED: Define factories based on data-model.md entities.
-->

```
[Entity]Factory
  → Creates valid [Entity] with randomized but realistic data
  → Accepts overrides for specific fields
  → Has named variants: .minimal(), .withRelations(), .invalid()
```

| Factory | Entity | Key Variants |
|---------|--------|-------------|
| [e.g., UserFactory] | User | `.admin()`, `.unverified()`, `.withOrders(n)` |
| [e.g., OrderFactory] | Order | `.pending()`, `.completed()`, `.cancelled()` |

### Test Database

**Strategy**: [e.g., fresh database per test suite, transaction rollback per test, shared database with cleanup]
**Isolation**: [e.g., each test file gets its own transaction that rolls back]
**Seeding**: [e.g., minimal seed data for integration tests, empty for unit tests]

## Coverage

### Targets

<!--
  Set realistic targets based on project maturity and type.
  100% coverage is rarely the goal — focus on meaningful coverage.
-->

| Metric | Target | Enforced in CI |
|--------|--------|---------------|
| Line coverage | [e.g., 80% / no target] | [Yes — fail below threshold / No — report only] |
| Branch coverage | [e.g., 70% / no target] | [Yes / No] |
| Function coverage | [e.g., 90% / no target] | [Yes / No] |

### Coverage Exclusions

[List files/directories excluded from coverage and why]
- `src/types/` — type definitions, no runtime code
- `src/config/` — environment-dependent, tested via integration
- `scripts/` — build/deploy scripts, not application code
- Generated files (migrations, codegen output)

## CI Integration

### When Tests Run

| Trigger | Unit | Integration | E2E | Contract |
|---------|------|-------------|-----|----------|
| Push to branch | ✅ | ✅ | ❌ | ✅ |
| Pull request | ✅ | ✅ | ✅ | ✅ |
| Merge to main | ✅ | ✅ | ✅ | ✅ |
| Pre-deploy | ❌ | ❌ | ✅ (smoke) | ❌ |

### Failure Policy

| Test Type | On Failure |
|-----------|-----------|
| Unit | Block merge |
| Integration | Block merge |
| E2E | Block merge (or warn-only for flaky tests with issue linked) |
| Contract | Block merge |

### Parallelization

**Strategy**: [e.g., split test files across CI workers, run unit and integration in parallel, E2E sequential]
**Sharding**: [e.g., 4 parallel workers for unit tests, 2 for integration]

## Test Conventions

### Naming

```
[file]:  [module].test.[ext]  or  test_[module].[ext]
[test]:  "should [expected behavior] when [condition]"
[suite]: "describe [Unit Under Test]"
```

### Structure (Arrange-Act-Assert)

```
1. Arrange: Set up test data, mocks, preconditions
2. Act:     Execute the function/endpoint/action under test
3. Assert:  Verify the expected outcome
4. Cleanup: (if needed) Reset state, close connections
```

### Rules

- Each test is independent — no shared mutable state between tests
- Tests clean up after themselves (no leftover data, files, or connections)
- No test depends on another test's execution order
- Flaky tests are marked, tracked with issue, and fixed within [e.g., 1 sprint]
- Test descriptions read as documentation of expected behavior
