# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.

  IMPORTANT: These fields drive conditional artifact generation.
  The agent evaluates each field to decide which design documents to produce.
  Fields set to "N/A" or "none" will cause their related artifacts to be SKIPPED.
  Fields set to "NEEDS CLARIFICATION" will be resolved during Phase 0 research.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app/saas or NEEDS CLARIFICATION]
**Authentication**: [e.g., JWT + OAuth2, session-based, API key, none or N/A]
**Deployment Target**: [e.g., Vercel, AWS ECS, Docker self-hosted, npm publish, N/A or NEEDS CLARIFICATION]
**CI/CD**: [e.g., GitHub Actions, GitLab CI, none or N/A]
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

## Artifact Generation Matrix

<!--
  The agent fills this matrix after evaluating Technical Context.
  Each artifact is either GENERATE (with reason) or SKIP (with reason).
  This gives full transparency into why specific documents exist or don't.
-->

| Artifact | Decision | Reason |
|----------|----------|--------|
| research.md | GENERATE (always) | Resolves unknowns from Technical Context |
| data-model.md | GENERATE (always) | Defines entities and relationships |
| contracts/ | [GENERATE / SKIP] | [e.g., "Project exposes REST API" or "Internal CLI, no external interfaces"] |
| api-spec.md | [GENERATE / SKIP] | [e.g., "Project Type is web-service" or "Library with no HTTP endpoints"] |
| frontend-spec.md | [GENERATE / SKIP] | [e.g., "React frontend in Primary Dependencies" or "API-only, no UI"] |
| backend-spec.md | [GENERATE / SKIP] | [e.g., "FastAPI backend with business logic" or "Static site, no server logic"] |
| auth-security.md | [GENERATE / SKIP] | [e.g., "Authentication is JWT + OAuth2" or "Authentication is N/A"] |
| infra.md | [GENERATE / SKIP] | [e.g., "Deployment Target is AWS ECS" or "CLI tool, N/A"] |
| testing-strategy.md | [GENERATE / SKIP] | [e.g., "Constitution mandates TDD" or "Prototype, testing deferred"] |
| quickstart.md | GENERATE (always) | Developer onboarding and setup |

## Project Structure

### Documentation (this feature)

<!--
  The tree below shows ALL possible artifacts. The agent removes lines
  marked SKIP in the Artifact Generation Matrix above when filling this in.
-->

```text
specs/[###-feature]/
├── plan.md                # This file (/speckit.plan command output)
├── research.md            # Phase 0 output (always generated)
├── data-model.md          # Phase 1 output (always generated)
├── api-spec.md            # Phase 1 output (if project exposes APIs)
├── frontend-spec.md       # Phase 1 output (if project has UI)
├── backend-spec.md        # Phase 1 output (if project has backend services)
├── auth-security.md       # Phase 1 output (if project has authentication)
├── infra.md               # Phase 1 output (if project is deployed)
├── testing-strategy.md    # Phase 1 output (if testing is required)
├── contracts/             # Phase 1 output (if project has external interfaces)
├── quickstart.md          # Phase 1 output (always generated)
└── tasks.md               # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
