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

> The agents UI and external consumers still use `apiServer`/`useAgentClient`, while DataApi is IPC-only.

**Review (pi):** The plan does not define the transport compatibility story. It must say whether `apiServer` routes delegate to the new DataApi services (thin wrappers), or whether the renderer migrates to `useQuery`/`useMutation` in this same change. Without this, DataApi services exist but callers still hit the Express path — half-migrated indefinitely.

**Resolved:** This PR is backend-only. The renderer currently uses `useAgentClient` (HTTP to `apiServer`) and that does not change here. The `apiServer` route handlers become thin delegates that call the new DataApi services — they are **not** deleted in this PR. A follow-up PR will migrate the renderer to `useQuery`/`useMutation`. Added explicit note to "What changes where" and a non-deletion constraint to Phase 7.

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
functions move to a plain module `src/main/services/agents/agentUtils.ts` (or inline where
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

**Note on schema conventions:** Existing DataApi schema files (`topics.ts`, `messages.ts`, etc.)
are TypeScript DTO interface files, **not** Zod validators. The new `agents.ts` will follow
the same pattern: plain `interface`/`type` definitions only. Validation lives in the handler
layer, not the schema file.

### Decision 5: IPC for agent session messages

`AgentMessageRepository` is currently called via two raw `ipcMain.handle` channels
(`AgentMessage_PersistExchange`, `AgentMessage_GetHistory`) registered in `ipc.ts`.
These move to DataApi endpoints. The message route will be session-centric —
`/sessions/:sid/messages` — matching the existing `sessionId`-only caller shape and
avoiding a forced renderer refactor in this PR. The IPC shims in `ipc.ts` are removed.

> These move to DataApi endpoints (`/agent-sessions/:id/messages`). The IPC shims in `ipc.ts` are removed.

**Review (pi):** This is underspecified. Current callers carry only `sessionId` and depend on `persistExchange`/`getHistory` semantics. Removing the IPC shims is not enough — the plan also needs explicit tasks for: (a) renderer migration to `useQuery`/`useMutation` for message history, (b) `IpcChannel` constant cleanup, (c) tests that currently stub the old IPC channels, and (d) docs/type updates for the new nested route shape.

**Resolved:** Route shape changed to `/sessions/:sid/messages` to match sessionId-only callers — no renderer refactor required in this PR. Added explicit Phase 5 tasks for IpcChannel constant removal and test stub updates. Renderer migration to `useQuery`/`useMutation` for messages is a follow-up (same as CRUD transport — Decision 1).

### Decision 6: SkillService split boundary

`SkillService` is **not** pure business data — `toggle`, `install`, `uninstall`, and
`initSkillsForAgent` all couple DB writes with filesystem symlink ops for consistency
(with rollback on symlink failure). This coupling is load-bearing.

The split is therefore:
- `src/main/data/services/SkillDataService.ts` — pure DB CRUD only (list, get, update
  metadata). Used by DataApi handlers for skill listing/details.
- `src/main/services/agents/skills/SkillService.ts` — **kept in place**, updated to use
  DB directly (removing `SkillRepository`/`AgentSkillRepository` inheritance). All
  install/toggle/uninstall/symlink ops remain here and are called via IPC as before.

This avoids splitting the DB+filesystem transaction boundary across two services.

### Decision 7: v2 error semantics

All new DataApi services (`AgentService`, `SessionService`, `TaskService`, `SkillDataService`,
`AgentSessionMessageService`) must use the existing SQLite error translation from
`src/main/data/db/sqliteErrors.ts` (unique constraint → typed error, etc.). This is not
optional — DataApi callers expect a typed error envelope, not raw Drizzle exceptions.

## What changes where

### Files deleted
- `src/main/services/agents/database/` (entire directory — shims + `sessionMessageRepository.ts`)
- `src/main/services/agents/skills/SkillRepository.ts`
- `src/main/services/agents/skills/AgentSkillRepository.ts`
- `src/main/services/agents/BaseService.ts`

### Files created
- `packages/shared/data/api/schemas/agents.ts` — TypeScript DTO interfaces for agents, sessions, tasks, skills, session-messages (no Zod — matches existing convention)
- `src/main/data/api/handlers/agents.ts` — thin DataApi handlers
- `src/main/data/services/AgentService.ts` — CRUD logic + default-session bootstrap + heartbeat setup + rollback
- `src/main/data/services/SessionService.ts`
- `src/main/data/services/TaskService.ts`
- `src/main/data/services/SkillDataService.ts` — DB-only skill CRUD (list, get, update metadata); replaces `SkillRepository` for read operations
- `src/main/data/services/AgentSessionMessageService.ts`
- `src/main/services/agents/agentUtils.ts` — pure helpers extracted from `BaseService`

### Files updated
- `src/main/data/api/handlers/index.ts` — spread `agentHandlers`
- `packages/shared/data/api/schemas/index.ts` — include agent schemas in `ApiSchemas`
- `src/main/ipc.ts` — remove `AgentMessage_PersistExchange`, `AgentMessage_GetHistory` IPC handlers; remove IpcChannel constants; remove `agentMessageRepository` import
- `src/main/services/agents/skills/SkillService.ts` — remove `SkillRepository`/`AgentSkillRepository` deps, call DB directly; keep all filesystem ops in place
- `src/main/services/agents/services/AgentService.ts` → **thin delegate** to `src/main/data/services/AgentService.ts`; **not deleted** (renderer still uses apiServer)
- `src/main/services/agents/services/SessionService.ts` → same
- `src/main/services/agents/services/TaskService.ts` → same
- `src/main/services/agents/services/ChannelService.ts` — remove `BaseService` extends, inline `getDatabase()`
- `src/main/services/agents/services/SchedulerService.ts` — update imports to `src/main/data/services/`
- `src/main/services/agents/services/claudecode/index.ts` — update imports to `src/main/data/services/`
- `src/main/services/agents/services/builtin/BuiltinAgentBootstrap.ts` — update imports
- `src/main/services/agents/services/channels/ChannelMessageHandler.ts` — update imports
- `src/main/mcpServers/claw.ts` — update import from `agents/database` → `@data/db/schemas/`
- `src/main/apiServer/routes/agents/handlers/agents.ts` — delegate to `src/main/data/services/AgentService.ts`

## Migration / implementation order

1. **Extract `agentUtils.ts`** from `BaseService` (pure functions only, no DB) — compile-tests immediately.
2. **Update `SkillService`** to use DB directly; drop `SkillRepository` and `AgentSkillRepository` extends.
3. **Delete `SkillRepository.ts`** and **`AgentSkillRepository.ts`** — compiler now guards missed callsites.
4. **Create DataApi schemas** (`packages/shared/data/api/schemas/agents.ts`) — TypeScript DTOs only.
5. **Create DataApi services** — port logic from old services; include session-bootstrap + rollback in `AgentService`; apply SQLite error translation throughout.
6. **Create DataApi handler** (`src/main/data/api/handlers/agents.ts`) and register in `index.ts`.
7. **Migrate `AgentMessageRepository`** into `AgentSessionMessageService`; add `/sessions/:sid/messages` route; remove IPC shims and IpcChannel constants from `ipc.ts`.
8. **Migrate internal consumers** — update `SchedulerService`, `claudecode`, `BuiltinAgentBootstrap`, `ChannelMessageHandler` imports to `src/main/data/services/`.
9. **Thin-wrap old apiServer services** — `AgentService.ts`/`SessionService.ts`/`TaskService.ts` in `services/agents/services/` become one-line delegates; do not delete (renderer still calls apiServer).
10. **Delete `database/` directory** — update remaining callers (`claw.ts`, `FeishuAdapter.ts`) to import from `@data/db/schemas/`.
11. **Delete `BaseService.ts`** — last step so compiler catches any missed extends.
12. **Update tests** — existing tests under `services/agents/services/__tests__/` to use new service locations and `setupTestDatabase()`; update stubs for removed IPC channels.

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

- [ ] Update `SkillService.ts` to call `application.get('DbService').getDb()` directly and import from `@data/db/schemas/agentGlobalSkill`, `@data/db/schemas/agentSkill`; keep all filesystem+DB coupling intact
- [ ] Delete `src/main/services/agents/skills/SkillRepository.ts`
- [ ] Delete `src/main/services/agents/skills/AgentSkillRepository.ts`
- [ ] Update `src/main/utils/builtinSkills.ts` if it imports from either file
- [ ] Run `pnpm lint && pnpm test`

### Phase 3: DataApi schemas

<!-- Schemas before handlers — TypeScript enforces exhaustive coverage at handler registration. -->

- [ ] Create `packages/shared/data/api/schemas/agents.ts` — TypeScript DTO interfaces (not Zod) for agents, sessions, tasks, skill metadata, and session-messages; message route shape is `/sessions/:sid/messages` (sessionId-only, matching current callers)
- [ ] Add agent schemas to `packages/shared/data/api/schemas/index.ts`

> Create `packages/shared/data/api/schemas/agents.ts` — routes and Zod schemas

**Review (pi):** The existing `packages/shared/data/api/schemas/` files are DTO/type definitions, not Zod validators — check `topics.ts`, `messages.ts` etc. before writing Zod here. Also the proposed message route shape (`/agents/:id/sessions/:sid/messages`) is mismatched with current `sessionId`-only callers; the schema task must either match today's call shape or include a callsite migration task in Phase 5.

**Resolved:** Confirmed — existing schema files are plain TypeScript interfaces. Updated task to say "TypeScript DTO interfaces (not Zod)". Route shape changed to `/sessions/:sid/messages` to match sessionId-only callers, no callsite migration needed.

### Phase 4: DataApi services

<!-- New service files under src/main/data/services/, one per subdomain. -->

- [ ] `AgentService.ts` — port CRUD + reorder + soft-delete + builtin-init; **must** include default-session bootstrap, heartbeat task setup, and agent-creation rollback (matching current `apiServer/routes/agents/handlers/agents.ts#createAgent`)
- [ ] `SessionService.ts` — port CRUD + slash-commands discovery
- [ ] `TaskService.ts` — port CRUD + scheduling-config persistence (keep SchedulerService for runtime tick)
- [ ] `SkillDataService.ts` — DB-only skill CRUD (list, get by id, update metadata); **not** install/toggle/uninstall (those stay in `SkillService.ts` with filesystem coupling)
- [ ] `AgentSessionMessageService.ts` — port `AgentMessageRepository.persistExchange` + `getSessionHistory`
- [ ] Each service wraps Drizzle ops in SQLite error translation from `src/main/data/db/sqliteErrors.ts`
- [ ] Run `pnpm test` with `setupTestDatabase()` for each new service

> - [ ] `AgentService.ts` — port CRUD + reorder + soft-delete + builtin-init from old file

**Review (pi):** Porting just the DB methods is not enough to preserve current behavior. `src/main/apiServer/routes/agents/handlers/agents.ts#createAgent` also creates the default session, rolls back agent creation if that bootstrap fails, and syncs heartbeat scheduling. The plan needs to assign those semantics to a concrete owner, otherwise a migrated create path will silently stop provisioning a usable agent.

**Resolved:** Updated `AgentService.ts` task to explicitly include default-session bootstrap, heartbeat task setup, and rollback on failure. These semantics move into the DataApi service, so both the old apiServer delegate and any future direct callers get the same behavior.

> - [ ] `SkillService.ts` (at `src/main/data/services/`) — port install/list/toggle from old file; filesystem ops (install/symlink) stay as IPC

**Review (pi):** I'm not convinced this split is coherent yet. In the current implementation, `toggle`, `install`, `uninstall`, `initSkillsForAgent`, and `enableForAllAgents` intentionally couple DB writes with filesystem side effects so DB state and symlinks stay in sync. If the new DataApi `SkillService` owns only the DB half while "filesystem ops stay as IPC," the plan should spell out the orchestration boundary and failure/rollback story.

**Resolved:** Split redesigned — see Decision 6. `SkillService.ts` stays in place and keeps full DB+filesystem coupling. A new `SkillDataService.ts` handles only read-only CRUD for listing/details in DataApi. The old `SkillService` is just updated to use DB directly (Phase 2), not moved or split across a boundary.

> port CRUD + reorder + soft-delete + builtin-init from old file

**Review (pi):** Calling this a DataApi migration should also include v2 error semantics — not only replacing `getDatabase()` calls. Existing DataApi services use `DataApiErrorFactory`, translate SQLite constraint errors to typed responses, and validate inputs. The new agent services need the same treatment; otherwise they'll return raw Drizzle exceptions to the renderer where DataApi callers expect a typed error envelope.

**Resolved:** Added explicit bullet: each service wraps Drizzle ops in SQLite error translation from `src/main/data/db/sqliteErrors.ts`. See also Decision 7.

### Phase 5: DataApi handlers + registration

- [ ] Create `src/main/data/api/handlers/agents.ts` — thin wrappers calling new services
- [ ] Add `agentHandlers` to `src/main/data/api/handlers/index.ts`
- [ ] Remove old `AgentMessage_PersistExchange` and `AgentMessage_GetHistory` IPC handlers from `src/main/ipc.ts`
- [ ] Remove `IpcChannel` constants for the two removed handlers
- [ ] Remove `agentMessageRepository` import from `src/main/ipc.ts`
- [ ] Update test stubs that currently mock `AgentMessage_PersistExchange` / `AgentMessage_GetHistory`

### Phase 6: Migrate internal consumers to new DataApi services

<!-- Before deleting old files, migrate everything that imports the old singletons.
     Compiler will catch any missed callsites in Phase 7. -->

- [ ] `src/main/services/agents/services/SchedulerService.ts` — update imports from `./AgentService`, `./SessionService`, `./TaskService` → `src/main/data/services/`
- [ ] `src/main/services/agents/services/claudecode/index.ts` — update imports
- [ ] `src/main/services/agents/services/builtin/BuiltinAgentBootstrap.ts` — update imports
- [ ] `src/main/services/agents/services/channels/ChannelMessageHandler.ts` — update imports
- [ ] `src/main/apiServer/routes/agents/handlers/agents.ts` — delegate `createAgent`, `updateAgent`, etc. to `src/main/data/services/AgentService.ts`; do not delete this file
- [ ] Run `pnpm lint && pnpm test` — all consumers must compile against new service locations

> - [ ] Delete `src/main/services/agents/services/AgentService.ts`
> - [ ] Delete `src/main/services/agents/services/SessionService.ts`
> - [ ] Delete `src/main/services/agents/services/TaskService.ts`
> - [ ] Delete `src/main/services/agents/BaseService.ts`

**Review (pi):** The deletion phase needs an explicit compatibility sweep before this step. Internal runtime code still imports the old singletons directly (`SchedulerService`, `ChannelMessageHandler`, `BuiltinAgentBootstrap`, `claudecode`, `mcpServers/claw.ts`, multiple tests, etc.). "Compiler catches it" is true, but without a planned wrapper/export strategy this becomes a huge tail of unrelated fixes at the end.

**Resolved:** Added Phase 6 to migrate all internal consumers before any deletions. The old service files in `services/agents/services/` become thin delegates (not deleted) to keep the apiServer path alive. `BaseService.ts` is the only file fully deleted in Phase 7.

### Phase 7: Delete `database/` shims + `BaseService`

- [ ] Update `src/main/mcpServers/claw.ts` import → `@data/db/schemas/agentSessionMessage`
- [ ] Update `src/main/services/agents/services/channels/adapters/feishu/FeishuAdapter.ts` import
- [ ] Update any remaining `from '../database/schema'` imports in service files
- [ ] Delete `src/main/services/agents/database/` directory
- [ ] Delete `src/main/services/agents/BaseService.ts`
- [ ] Verify `src/main/services/agents/services/index.ts` exports only live code (thin delegates + SkillService)
- [ ] Final `pnpm lint && pnpm test && pnpm format`

> The plan does not define the transport compatibility story. It must say whether `apiServer` routes delegate to the new DataApi services (thin wrappers), or whether the renderer migrates to `useQuery`/`useMutation` in this same change.

**Review (pi):** Without this, DataApi services exist but callers still hit the Express path — half-migrated indefinitely.

**Resolved:** See Decision 1 resolution. Old `AgentService.ts`/`SessionService.ts`/`TaskService.ts` in `services/agents/services/` become thin delegates, not deleted. apiServer routes continue to work. Renderer migration is a follow-up PR.
