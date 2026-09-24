<!-- impeccable:product-schema 1 -->

# The Boss product context

## Platform

`web` — The Boss is a cross-platform Electron desktop application with a shared React renderer. The primary customer release targets are Windows x64 and Apple Silicon macOS.

## Users

Developers and technical operators who use The Boss as their daily AI workspace and need to administer local agent runtimes, project tools, models, memory, and supporting services without leaving the application.

## Purpose

The Boss is the operator-facing administration surface for the Universal Agent Runtime and its integrations. It must make agent catalogs, project-scoped Compass graphs, filesystem MCP access, model routing, SurrealDB storage, memory, and managed or existing services understandable and operable without requiring users to remember provider strings, service commands, or hidden configuration locations.

## Positioning

The product combines a conversational AI workspace with supervised local runtime administration. Its distinguishing behaviors are workspace isolation, explicit service ownership, packaged tools and skills, observable operations, and an inspectable difference between requested configuration and the configuration currently running.

## Operating context

- Windows and macOS desktop use, with platform-managed binaries and settings.
- Managed Docker services or independently installed services from a full Prometheus skill pack.
- Embedded or remote SurrealDB selected by the operator.
- Long-running setup, indexing, and diagnostics that must remain understandable while in progress and after completion.
- Configuration shared across the renderer, encrypted main-process storage, sidecars, and MCP session lifecycles.

## Product constraints

- Never expose stored secrets in renderer snapshots, logs, or ordinary preference responses.
- Treat application-managed and externally owned services independently; never take lifecycle control of external services.
- Show requested and effective runtime state separately, including pending apply work and the last apply error.
- Use the existing Cherry settings primitives, design tokens, navigation, and search conventions.
- Route every visible string through internationalization and preserve keyboard and screen-reader access.
- Validate completed user journeys at integration boundaries rather than accumulating implementation-shaped unit tests.

## Brand and interface character

The Boss is calm, precise, and utilitarian. Settings should use the incumbent Cherry visual language: clear hierarchy, compact controls, readable status text, restrained motion, and no decorative treatment that competes with operational information.

## Design principles

1. Name the work in progress, show its output, and leave a durable success or failure result with a concrete recovery action.
2. Make ownership and effective state visible before offering lifecycle controls.
3. Use progressive disclosure for credentials, logs, and advanced configuration while keeping failures and required actions visible.
4. Prefer choices populated from authoritative catalogs over free-form identifiers.
5. Keep every automated decision inspectable and reversible by the operator.

## Evidence

- Existing repository architecture and `DESIGN.md`.
- Operator-supplied screenshots of the current service and MCP administration surfaces.
- Approved OpenSpec change `integration-administration` and its KBD assessment, analysis, and plan.
