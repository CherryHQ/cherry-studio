# Architecture Overview

> **Note**: The v2 branch is undergoing a major architecture refactoring. This document will be continuously updated as the refactoring progresses. Some sections may describe the target architecture rather than the current state.

This document provides a high-level overview of Cherry Studio's architecture, covering the Electron process model, key subsystems, data flow, and monorepo structure.

## Process Model

Cherry Studio is an Electron application with three process types:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Process                             │
│  (Node.js — src/main/)                                         │
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────────────┐ │
│  │ Lifecycle    │ │ Data Layer   │ │ Services                │ │
│  │ Container    │ │              │ │                         │ │
│  │ (IoC, phased│ │ DbService    │ │ MainWindowService           │ │
│  │  bootstrap) │ │ CacheService │ │ McpService              │ │
│  │              │ │ Preference   │ │ KnowledgeService        │ │
│  │              │ │ DataApi      │ │ AgentBootstrapService   │ │
│  │              │ │ BootConfig   │ │ SearchService           │ │
│  │              │ │              │ │ ... (27 total)          │ │
│  └──────────────┘ └──────────────┘ └─────────────────────────┘ │
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────────────┐ │
│  │ API Server   │ │ Knowledge    │ │ MCP Servers             │ │
│  │ (Express)    │ │ (RAG)        │ │ (Model Context Protocol)│ │
│  └──────────────┘ └──────────────┘ └─────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ IPC (contextBridge)
                  ┌─────────┴─────────┐
                  │   Preload Scripts  │
                  │   (src/preload/)   │
                  └─────────┬─────────┘
                            │
┌───────────────────────────┴─────────────────────────────────────┐
│                     Renderer Process                            │
│  (Chromium — src/renderer/)                                     │
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────────────┐ │
│  │ React 19     │ │ State        │ │ Data Hooks              │ │
│  │ UI Layer     │ │              │ │                         │ │
│  │ (Shadcn UI + │ │ Redux Store  │ │ useQuery / useMutation  │ │
│  │  Tailwind)   │ │ (messages,   │ │ usePreference           │ │
│  │              │ │  assistants) │ │ useCache / usePersist   │ │
│  │ TipTap Editor│ │              │ │                         │ │
│  └──────────────┘ └──────────────┘ └─────────────────────────┘ │
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────────────┐ │
│  │ AI Core      │ │ Pages        │ │ Windows                 │ │
│  │ (Provider    │ │ (Chat, Agent │ │ (Main, Mini,            │ │
│  │  middleware)  │ │  Settings)   │ │  Selection Toolbar)     │ │
│  └──────────────┘ └──────────────┘ └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

A typical user interaction follows this path:

```
User Input (React UI)
  │
  ├── Chat Message ──→ AI Core (Provider Middleware) ──→ LLM API
  │                         │
  │                         ├── Stream chunks ──→ Redux Store ──→ UI Update
  │                         └── Message blocks ──→ DataApi ──→ SQLite (persist)
  │
  ├── Setting Change ──→ usePreference ──→ IPC ──→ PreferenceService ──→ SQLite
  │                                                     │
  │                                                     └── Broadcast to all windows
  │
  └── Business Data ──→ useQuery/useMutation ──→ IPC ──→ DataApi Handler
       (topics, files)                                       │
                                                             ├── Service Layer
                                                             ├── Repository Layer
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

Services that own long-lived resources use the lifecycle system (IoC container with phased bootstrap):

```
Application Bootstrap
  │
  ├── Phase 1: Infrastructure
  │     DbService → CacheService → PreferenceService → DataApiService
  │
  ├── Phase 2: Core Services
  │     MainWindowService, ProxyManager, ThemeService, ShortcutService, ...
  │
  ├── Phase 3: Feature Services
  │     McpService, KnowledgeService, SearchService, ...
  │
  └── Phase 4: Late Services
        AppUpdaterService, AgentBootstrapService, ApiServerService, ...
```

Services register in `src/main/core/application/serviceRegistry.ts` and are accessed via `application.get('ServiceName')`. See [Lifecycle Reference](./lifecycle/README.md) for full documentation.

## AI Core Architecture

The AI processing pipeline uses a three-layer middleware pattern:

```
User Message
  │
  ├── Provider Registry ──→ Select AI provider (OpenAI, Anthropic, etc.)
  │
  ├── Middleware Chain ──→ Pre-processing (context, knowledge, tools)
  │
  ├── Vercel AI SDK v5 ──→ Streaming LLM call
  │
  └── Response Pipeline ──→ Message blocks (text, code, image, tool-call)
```

See [AI Reference](./ai/README.md) for the complete data flow.

## Monorepo Structure

```
cherry-studio
├── src/
│   ├── main/                    # Main process (Node.js)
│   │   ├── core/                #   App runtime infra, business-agnostic (lifecycle, paths)
│   │   ├── data/                #   Data infra + data-related business config (DB, Cache, Preference, DataApi)
│   │   ├── ai/                  #   All AI-related code (providers, middleware, MCP)
│   │   ├── features/            #   Large, multi-file domain modules (apiGateway, ...)
│   │   ├── services/            #   Small, independent / cross-domain services
│   │   └── utils/               #   Small, independent / cross-domain utilities
│   │
│   ├── renderer/                # Renderer process (React) — directory layout in ./renderer-architecture.md
│   │
│   ├── preload/                 # Preload scripts (IPC bridge)
│   │
│   └── shared/                  # Shared types, schemas, constants
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

Main-process and renderer code is organized by **feature** (`features/` — high-cohesion domain modules) versus **type-bucket** (`services/`, `utils/`, `components/`, `hooks/` — small, independent pieces). See [Naming Conventions §4.10](./naming-conventions.md) for the placement rule. For the renderer's full layering, directory responsibilities, and dependency rules, see [Renderer Architecture](./renderer-architecture.md).

## Key Subsystems

`core/` holds the application runtime (business-agnostic):

| Subsystem | Location | Documentation |
|-----------|----------|---------------|
| Service Lifecycle (IoC container) | `src/main/core/lifecycle/`, `src/main/core/application/` | [Lifecycle Reference](./lifecycle/README.md) |
| Window Manager | `src/main/core/window/` | [Window Manager Reference](./window-manager/README.md) |
| Scheduler & Jobs | `src/main/core/scheduler/`, `src/main/core/job/` | [Job & Scheduler Reference](./job-and-scheduler/README.md) |
| Paths | `src/main/core/paths/` | [Paths README](../../src/main/core/paths/README.md) |

Data infrastructure (`data/`) is detailed in [Four Data Systems](#four-data-systems); AI in [AI Core Architecture](#ai-core-architecture).

## Window Architecture

Cherry Studio runs multiple windows, each with its own renderer entry point:

| Window | Purpose |
|--------|---------|
| Main Window | Primary chat and settings interface |
| Quick Assistant | Quick-access floating panel |
| Selection Toolbar | Text selection actions overlay |

All windows are managed by `WindowManager` (`src/main/core/window/`) and communicate through IPC and shared state (CacheService, PreferenceService). See [Window Manager Reference](./window-manager/README.md).
