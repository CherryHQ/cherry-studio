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

## Current modules

| Module | Description | Reference Docs |
|--------|-------------|----------------|
| `application/` | Application singleton, service registry, bootstrap orchestration | [Lifecycle Reference](../../../docs/en/references/lifecycle/README.md) |
| `lifecycle/` | IoC container, service lifecycle management, phased bootstrap | [Lifecycle Reference](../../../docs/en/references/lifecycle/README.md) |
