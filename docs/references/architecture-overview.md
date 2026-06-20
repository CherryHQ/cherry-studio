# Architecture Overview

> **Note**: `main` is undergoing a major v2 architecture refactoring (v1 and v2 coexist). This document is updated as it progresses; some sections describe the **target** architecture rather than the current state.

This is the cross-process entry point to Cherry Studio's architecture: the Electron process model, data flow, the data systems, the monorepo structure, and a map to the detailed per-process and per-subsystem references. Per-process directory layout and dependency rules live in their own documents — this page does not duplicate them.

## Process Model

Cherry Studio is an Electron app with two app processes (plus preload), each mapping to a `src/` root and its top-level directories:

```
═══ Main Process · Node.js · src/main/ ══════════════════════════════════

  core/       app runtime — IoC container, paths, logger, window, scheduler/jobs
  data/       data layer — Db, Cache, Preference, DataApi, BootConfig
  ai/         AI subsystem — providers, middleware, MCP, agents, streams
  features/   large domain modules    ·    services/  small business services
  ipc/        IpcApi — the typed boundary to the renderer
  (also hosts: Express API server · MCP servers · knowledge / RAG)

                   ↕   IPC over contextBridge   ·   src/preload/

═══ Renderer Process · Chromium · src/renderer/ ═════════════════════════

  windows/     per-window entry roots — Main, Sub, Selection, …
  pages/       route views — Chat, Agent, Settings, …
  features/    domain UI modules
  data hooks   useQuery / useMutation / usePreference / useCache
  ai core      provider middleware
  UI           React 19 · Shadcn UI · Tailwind · TipTap
```

## Data Flow

A typical user interaction follows this path:

```
User Input (React UI)
  │
  ├── Chat Message ──→ AI Core (provider middleware) ──→ LLM API
  │                        │
  │                        ├── Stream chunks ──→ renderer chat state ──→ UI update
  │                        └── Message blocks ──→ DataApi ──→ SQLite (persist)
  │
  ├── Setting Change ──→ usePreference ──→ IPC ──→ PreferenceService ──→ SQLite
  │                                                    └── broadcast to all windows
  │
  └── Business Data ──→ useQuery / useMutation ──→ IPC ──→ DataApi handler
       (topics, files)                                       │
                                                             ├── Service layer
                                                             ├── Repository layer
                                                             └── SQLite (Drizzle ORM)
```

## Four Data Systems

Cherry Studio uses four data systems, each optimized for different data characteristics:

| System | Storage | Timing | Use Case |
|--------|---------|--------|----------|
| [**BootConfig**](./data/boot-config-overview.md) | JSON file | Pre-lifecycle (sync) | Chromium flags, hardware accel |
| [**Cache**](./data/cache-overview.md) | Memory (per-process) / Shared (Main-relayed) / Persist (renderer localStorage) | Runtime | Temp data, UI state, cross-window coordination |
| [**Preference**](./data/preference-overview.md) | SQLite | Post-lifecycle | User settings (theme, language) |
| [**DataApi**](./data/data-api-overview.md) | SQLite (Drizzle) | Post-lifecycle | Business data (topics, messages) |

See [Data System Reference](./data/README.md) for detailed architecture, decision flowcharts, and usage patterns.

## Service Lifecycle

Main-process services that own long-lived resources or persistent side effects run on an IoC container with a phased bootstrap (Background → BeforeReady → WhenReady), registered one line each in `src/main/core/application/serviceRegistry.ts` and resolved via `application.get('ServiceName')`. See [Lifecycle Reference](./lifecycle/README.md) for the phases, decorators, and migration guide; see [Main Process Architecture](./main-process-architecture.md) for where services sit in the directory layout.

## AI Core Architecture

The AI pipeline selects a provider, runs a middleware chain (context, knowledge, tools), streams via the Vercel AI SDK, and emits typed message blocks (text, code, image, tool-call). See [AI Reference](./ai/README.md) for the full pipeline and data flow.

## Monorepo Structure

```
cherry-studio
├── src/
│   ├── main/                    # Main process (Node.js) — directory layout in ./main-process-architecture.md
│   │
│   ├── renderer/                # Renderer process (React) — directory layout in ./renderer-architecture.md
│   │
│   ├── preload/                 # Preload scripts (IPC bridge)
│   │
│   └── shared/                  # Cross-process primitives: types, schemas/contracts, pure logic — layout in ./shared-layer-architecture.md
│
├── packages/
│   ├── ui/                      #   @cherrystudio/ui (Shadcn + Tailwind)
│   ├── aiCore/                  #   @cherrystudio/ai-core
│   ├── ai-sdk-provider/         #   Custom AI SDK providers
│   ├── provider-registry/       #   Provider registry
│   ├── mcp-trace/               #   OpenTelemetry tracing
│   └── extension-table-plus/    #   TipTap table extension
│
├── docs/                        # Documentation (this directory)
│   ├── guides/                  #   How-to guides
│   └── references/              #   Technical references
│
└── scripts/                     # Build, lint, i18n, and CI scripts
```

Main-process and renderer code is organized by **feature** (`features/` — high-cohesion domain modules) versus **type-bucket** (`services/`, `utils/`, `components/`, `hooks/` — small, independent pieces); see [Naming Conventions §4.10](./naming-conventions.md) for the placement rule. `src/shared/` is the **cross-process primitive layer** — types, schemas/contracts, and pure logic importable by **both** `main` and `renderer`, depending on no app code (being cross-process is the entry gate). Full layering and dependency rules live in the per-process docs below.

## Reference Map

Where to go for detail. The three process docs own per-process directory layout and dependency rules; subsystem internals live in their own references.

| Area | Reference |
|---|---|
| Main-process directory charters & dependency rules | [Main Process Architecture](./main-process-architecture.md) |
| Renderer directory layering & dependency rules | [Renderer Architecture](./renderer-architecture.md) |
| Cross-process primitives (`@shared`) | [Shared Layer Architecture](./shared-layer-architecture.md) |
| Naming (files, directories, identifiers) | [Naming Conventions](./naming-conventions.md) |
| Data systems (BootConfig / Cache / Preference / DataApi) | [Data System Reference](./data/README.md) |
| IPC (IpcApi) | [IPC Reference](./ipc/README.md) |
| Service lifecycle (IoC, phased bootstrap) | [Lifecycle Reference](./lifecycle/README.md) |
| Window manager (multi-window, pooling) | [Window Manager Reference](./window-manager/README.md) |
| Scheduler & jobs | [Job & Scheduler Reference](./job-and-scheduler/README.md) |
| AI subsystem | [AI Reference](./ai/README.md) |
| Path registry | [paths/README](../../src/main/core/paths/README.md) |

Cherry Studio runs multiple windows (main window, sub-windows, selection toolbar, …), all managed by `WindowManager` and communicating through IPC and shared state (Cache, Preference); see the [Window Manager Reference](./window-manager/README.md).
