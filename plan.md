# Plan: Agents DataApi Migration & Dead Code Removal

## Problem

The agents service layer predates the v2 architecture. It uses a bespoke `BaseService` class
with `application.get('DbService').getDb()` calls scattered across service files, re-exports
old schema aliases (`agentsTable` → `agentTable`, etc.), and maintains three repository
classes (`SkillRepository`, `AgentSkillRepository`, `AgentMessageRepository`) that duplicate
the pattern the v2 DataApi already handles for topics, messages, MCP servers, etc.

The `src/main/services/agents/database/` directory contains only:
- compatibility shim schemas re-exporting from `@data/db/schemas/`
- `sessionMessageRepository.ts` (raw Drizzle class)

The directory was explicitly marked `@deprecated` and `TODO: Remove` in PR
`feat/agents-main-db-migration`. `SkillRepository.ts` carries the same `TODO`.

Until these are removed, new contributors have two paths for DB access in the same domain
(the shims vs. `@data/db/schemas` directly), and the `BaseService` inheritance chain is a
load-bearing anti-pattern that blocks lifecycle-managed services.

## How we got here

- `feat/agents-main-db-migration` moved agent tables into the main SQLite DB (migration 0012)
  and added compatibility re-exports so agent services could keep compiling without a full rewrite.
- `BaseService.getDatabase()` now calls `application.get('DbService').getDb()` — already v2-correct
  for the DB call itself, but the surrounding class hierarchy is not lifecycle-managed.
- The DataApi (Handler → Service → Drizzle) pattern is established for topics, messages,
  assistants, MCP servers, models, providers, miniapps, tags, translate, knowledge.
- Agent endpoints currently go through the Express-style API server (`src/main/apiServer/`) with
  `agentService`, `sessionService`, `taskService`, `channelService` as manual singletons — a
  separate path that does **not** go through DataApi.

## Design decisions

### Decision 1: Scope — what moves to DataApi, what stays in apiServer

The agents domain has two distinct access patterns:

| Category | Current | Destination |
|---|---|---|
| Agent CRUD, Session CRUD, Task CRUD, Skill CRUD | apiServer + BaseService singletons | **DataApi** (Handler → Service → Drizzle) |
| Message persistence (session messages) | `AgentMessageRepository` via IPC | **DataApi** (new agent-messages handler) |
| Channel runtime (start/stop adapters, streaming) | ChannelManager via IPC | **Keep in IPC** — runtime, not business data |
| Scheduler runtime (tick, run task) | SchedulerService via IPC | **Keep in IPC** — imperative control flow |
| Skill installation (git clone, symlink) | SkillService.install() via IPC | **Keep in IPC** — side-effectful filesystem ops |

The DataApi scope rule ("business data with a dedicated table, user-created, severe if lost")
applies cleanly to agents, sessions, tasks, skills, session-messages. It does not apply to
channel-start/stop or scheduler-tick.

**Alternative considered:** keep agents in apiServer, only remove the dead files.  
**Ruled out:** the apiServer path does not get DataApi's retry/error handling, and the
`BaseService` + singleton pattern will be a permanent maintenance burden. The investment
to move to DataApi pays off in consistency and test coverage.

### Decision 2: Remove `database/` shims and `SkillRepository` in this PR

The shim files (`database/schema/*.ts`) only re-export from `@data/db/schemas/`. Keeping
them alive forces every reader to wonder "which import path is canonical?" Removing them
and updating callsites is mechanical and reviewable in one PR. Doing it separately from the
DataApi refactor would leave the codebase in a third intermediate state.

`SkillRepository` and `AgentSkillRepository` become dead code once `SkillService` and
its callers are updated to import from `@data/db/schemas/agentGlobalSkill` and
`@data/db/schemas/agentSkill` directly.

### Decision 3: `BaseService` — migrate DB calls, keep non-DB helpers

`BaseService` mixes DB access with reusable utilities (`serializeJsonFields`,
`deserializeJsonFields`, `ensurePathsExist`, `validateAgentModels`, `listMcpTools`).
The DB accessor (`getDatabase()`) and the class hierarchy are removed. The utility
functions move to a plain module `src/main/services/agents/utils.ts` (or inline where
they're trivially small). Services that need DB access call
`application.get('DbService').getDb()` directly (same as v2 DataApi services do).

**Alternative considered:** convert `BaseService` to a lifecycle-managed `@Injectable` service.  
**Ruled out:** the utilities are pure functions with no lifecycle needs. Wrapping them
in a service just to pass them around adds indirection without benefit.

### Decision 4: DataApi schema files location

New DataApi schemas for agents go in `packages/shared/data/api/schemas/agents.ts` following
the existing convention (`topics.ts`, `messages.ts`, etc.). Handler files go in
`src/main/data/api/handlers/agents.ts`, service files in `src/main/data/services/AgentService.ts`
(etc.).

The existing `src/main/services/agents/services/AgentService.ts` et al. become the migration
target — their logic moves into the new service files, then the old files are deleted.

### Decision 5: IPC for agent session messages

`AgentMessageRepository` is currently called via two raw `ipcMain.handle` channels
(`AgentMessage_PersistExchange`, `AgentMessage_GetHistory`) registered in `ipc.ts`.
These move to DataApi endpoints (`/agent-sessions/:id/messages`). The IPC shims in
`ipc.ts` are removed.

## What changes where

### Files deleted
- `src/main/services/agents/database/` (entire directory — shims + `sessionMessageRepository.ts`)
- `src/main/services/agents/skills/SkillRepository.ts`
- `src/main/services/agents/skills/AgentSkillRepository.ts`
- `src/main/services/agents/BaseService.ts`

### Files created
- `packages/shared/data/api/schemas/agents.ts` — Zod schemas + route map for agents, sessions, tasks, skills, session-messages
- `src/main/data/api/handlers/agents.ts` — thin DataApi handlers
- `src/main/data/services/AgentService.ts` — CRUD logic (from old `services/AgentService.ts`)
- `src/main/data/services/SessionService.ts`
- `src/main/data/services/TaskService.ts`
- `src/main/data/services/SkillService.ts` — merges `SkillRepository` + `SkillService` logic
- `src/main/data/services/AgentSessionMessageService.ts`
- `src/main/services/agents/agentUtils.ts` — pure helpers extracted from `BaseService` (serialize/deserialize JSON, path resolution, model validation, MCP tool listing)

### Files updated
- `src/main/data/api/handlers/index.ts` — spread `agentHandlers`
- `packages/shared/data/api/schemas/index.ts` — include agent schemas in `ApiSchemas`
- `src/main/ipc.ts` — remove `AgentMessage_PersistExchange`, `AgentMessage_GetHistory` IPC handlers; remove `agentMessageRepository` import
- `src/main/services/agents/skills/SkillService.ts` — remove `SkillRepository`/`AgentSkillRepository` deps, import from `@data/db/schemas/` directly
- `src/main/services/agents/services/AgentService.ts` → thin wrapper or deleted once DataApi service is live
- `src/main/services/agents/services/SessionService.ts` → same
- `src/main/services/agents/services/TaskService.ts` → same
- `src/main/services/agents/services/ChannelService.ts` — remove `BaseService` extends, inline `getDatabase()`
- `src/main/services/agents/services/SchedulerService.ts` — same
- `src/main/mcpServers/claw.ts` — update import from `agents/database` → `@data/db/schemas/`
- `src/main/services/agents/database/schema/*.ts` remaining callers in `ipc.ts`, `FeishuAdapter.ts`

## Migration / implementation order

1. **Extract `agentUtils.ts`** from `BaseService` (pure functions only, no DB) — compile-tests immediately.
2. **Update `SkillService`** to import from `@data/db/schemas/agentGlobalSkill`, `@data/db/schemas/agentSkill` directly; drop `SkillRepository` and `AgentSkillRepository` extends.
3. **Delete `SkillRepository.ts`** and **`AgentSkillRepository.ts`** — compiler now guards missed callsites.
4. **Create DataApi schemas** (`packages/shared/data/api/schemas/agents.ts`).
5. **Create DataApi services** (`src/main/data/services/Agent*.ts`) — port logic from old services, using `application.get('DbService').getDb()` directly.
6. **Create DataApi handler** (`src/main/data/api/handlers/agents.ts`) and register in `index.ts`.
7. **Migrate `AgentMessageRepository`** into `AgentSessionMessageService` under `src/main/data/services/`; add handler routes; remove IPC shims from `ipc.ts`.
8. **Delete `database/` directory** — update remaining callers (`claw.ts`, `ipc.ts`, `FeishuAdapter.ts`) to import from `@data/db/schemas/`.
9. **Delete old service files** (`src/main/services/agents/services/AgentService.ts` et al.) once DataApi services cover all callsites.
10. **Delete `BaseService.ts`** — last step so compiler catches any missed extends.
11. **Update tests** — existing tests under `services/agents/services/__tests__/` to use new service locations and `setupTestDatabase()`.

## Tasks

### Phase 1: Pure utility extraction (no functional change)

<!-- Safest first: extract helpers with no DB access so the rest of the refactor
     has a clean utility module to depend on. -->

- [ ] Create `src/main/services/agents/agentUtils.ts` with `serializeJsonFields`, `deserializeJsonFields`, `ensurePathsExist`, `resolveAccessiblePaths`, `validateAgentModels`, `listMcpTools`, `normalizeAllowedTools` from `BaseService`
- [ ] Update all callers within `services/agents/` to import from `agentUtils` instead of inheriting `BaseService`
- [ ] Run `pnpm lint && pnpm test` — no failures expected

### Phase 2: Remove SkillRepository / AgentSkillRepository

<!-- These two files are pure DB-access wrappers. Removing them forces SkillService
     to import table refs directly — cleaner and closer to v2 style. -->

- [ ] Update `SkillService.ts` to call `application.get('DbService').getDb()` directly and import from `@data/db/schemas/agentGlobalSkill`, `@data/db/schemas/agentSkill`
- [ ] Delete `src/main/services/agents/skills/SkillRepository.ts`
- [ ] Delete `src/main/services/agents/skills/AgentSkillRepository.ts`
- [ ] Update `src/main/utils/builtinSkills.ts` if it imports from either file
- [ ] Run `pnpm lint && pnpm test`

### Phase 3: DataApi schemas

<!-- Schemas before handlers — TypeScript enforces exhaustive coverage at handler registration. -->

- [ ] Create `packages/shared/data/api/schemas/agents.ts` — routes and Zod schemas for `/agents`, `/agents/:id`, `/agents/:id/sessions`, `/agents/:id/sessions/:sid`, `/agents/:id/tasks`, `/agents/:id/tasks/:tid`, `/agents/:id/sessions/:sid/messages`, `/skills`, `/skills/:id`
- [ ] Add agent schemas to `packages/shared/data/api/schemas/index.ts`

### Phase 4: DataApi services

<!-- New service files under src/main/data/services/, one per subdomain. -->

- [ ] `AgentService.ts` — port CRUD + reorder + soft-delete + builtin-init from old file
- [ ] `SessionService.ts` — port CRUD + slash-commands discovery
- [ ] `TaskService.ts` — port CRUD + scheduling logic (keep SchedulerService for runtime tick)
- [ ] `SkillService.ts` (at `src/main/data/services/`) — port install/list/toggle from old file; filesystem ops (install/symlink) stay as IPC
- [ ] `AgentSessionMessageService.ts` — port `AgentMessageRepository.persistExchange` + `getSessionHistory`
- [ ] Run `pnpm test` with `setupTestDatabase()` for each new service

### Phase 5: DataApi handlers + registration

- [ ] Create `src/main/data/api/handlers/agents.ts` — thin wrappers calling new services
- [ ] Add `agentHandlers` to `src/main/data/api/handlers/index.ts`
- [ ] Remove old `AgentMessage_PersistExchange` and `AgentMessage_GetHistory` IPC handlers from `src/main/ipc.ts`
- [ ] Remove `agentMessageRepository` import from `src/main/ipc.ts`

### Phase 6: Delete `database/` shims

- [ ] Update `src/main/mcpServers/claw.ts` import → `@data/db/schemas/agentSessionMessage`
- [ ] Update `src/main/services/agents/services/channels/adapters/feishu/FeishuAdapter.ts` import
- [ ] Update any remaining `from '../database/schema'` imports in service files
- [ ] Delete `src/main/services/agents/database/` directory
- [ ] Run `pnpm lint` — TS must find no broken imports

### Phase 7: Delete old service files + BaseService

<!-- Last, so the compiler catches every missed callsite during Phases 1–6. -->

- [ ] Delete `src/main/services/agents/services/AgentService.ts`
- [ ] Delete `src/main/services/agents/services/SessionService.ts`
- [ ] Delete `src/main/services/agents/services/TaskService.ts`
- [ ] Delete `src/main/services/agents/BaseService.ts`
- [ ] Verify `src/main/services/agents/services/index.ts` and `index.ts` export only live code
- [ ] Final `pnpm lint && pnpm test && pnpm format`
