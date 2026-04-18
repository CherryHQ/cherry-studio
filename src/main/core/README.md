# Core

This directory contains **application-level infrastructure** that is independent of business logic.

Core services are things the app needs to function as an Electron application — regardless of what the app actually does. If you swapped out all the business features tomorrow, these modules would still be necessary.

## What belongs here

- Lifecycle management (service registration, bootstrap, shutdown)
- Logging infrastructure
- Configuration management
- IPC communication framework
- Plugin/extension system plumbing
- Platform abstraction utilities

## What does NOT belong here

- Anything tied to what Cherry Studio specifically does (AI, conversations, models, topics, assistants, knowledge bases, MCP, etc.)
- Business data schemas, repositories, or services
- UI-specific logic
- Feature-specific utilities

**Rule of thumb:** If removing a module would break the app regardless of its features, it belongs in `core/`. If removing it would only break a specific feature, it belongs elsewhere (e.g., `services/`, `data/`).

## Startup phases

The v2 main process has three startup phases. This is the preferred
terminology across the codebase.

| Phase | Owned by | Description |
|-------|----------|-------------|
| **preboot** | `core/preboot/` | Synchronous setup that must complete before `application.bootstrap()` is called. BootConfig load, logger init, userData resolution, command-line switches, top-level Electron APIs. No DI, no lifecycle services. |
| **bootstrap** | `core/application/` + `core/lifecycle/` | The `application.bootstrap()` orchestration function. Freezes the path registry, builds the IoC container, runs the lifecycle stages (Background / BeforeReady / WhenReady). NestJS/Spring-style terminology — this is the only meaning of "bootstrap" in this codebase. |
| **running** | (no explicit owner) | Steady state after `application.bootstrap()` returns. All services ready, main window visible, IPC and user events flowing normally. |

The lifecycle stages (Background / BeforeReady / WhenReady) run *inside*
the bootstrap phase, not as separate top-level phases.

The legacy file `src/main/bootstrap.ts` predates this vocabulary and is
no longer imported anywhere. It will be removed in a follow-up cleanup PR.

## Current modules

| Module | Description | Reference Docs |
|--------|-------------|----------------|
| `application/` | Application singleton, service registry, bootstrap orchestration | [Lifecycle Reference](../../../docs/references/lifecycle/README.md) |
| `lifecycle/` | IoC container, service lifecycle management, phased bootstrap | [Lifecycle Reference](../../../docs/references/lifecycle/README.md) |
| `logger/` | Winston-based logging service (preboot singleton, consumed via `@logger` alias) | [logging.md](../../../docs/guides/logging.md) |
| `paths/` | Path registry: single source of truth for all main-process filesystem paths | [paths/README.md](./paths/README.md) |
| `preboot/` | Pre-bootstrap synchronous setup (userData resolution, etc.) | [preboot/README.md](./preboot/README.md) |
