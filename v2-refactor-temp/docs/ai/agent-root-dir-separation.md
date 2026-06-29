# Agent Root Directory Separation

> **Status (2026-06-28): IMPLEMENTED, with expanded scope.** This doc captured the original
> root-dir-only design (scoped to soul-mode agents). In review the scope grew to **remove
> `soul_enabled` entirely** — personality + autonomy are now default for *every* agent, the soul/
> standard prompt paths are unified (`claude_code` preset + personality append), bootstrap runs for
> all new agents, and the interactive-tool restriction moved to a per-run autonomous policy with a
> per-task permission choice. The authoritative final design is the approved plan
> (`~/.claude/plans/wobbly-strolling-eich.md`); user impact is in
> `v2-refactor-temp/docs/breaking-changes/2026-06-28-agent-personality-default-and-root-dir.md`.
> The root-dir mechanics below are accurate; the "soul-mode only" scoping notes are superseded.



**Status:** Design — approved for implementation
**Branch:** `DeJeune/agent-root-dir-separation`
**Area:** `src/main/ai/agents`, `src/main/ai/runtime/claudeCode`, `src/main/data/migration/v2`

## 1. Problem

Every agent's identity (`SOUL.md`, `USER.md`, `system.md`) and memory (`memory/FACT.md`,
`memory/JOURNAL.jsonl`) currently lives in the **same directory** the agent uses as its working
directory (`cwd`). Both are derived from a single value: `session.workspace.path`.

This conflation causes two concrete defects on `main`:

- **Memory doesn't persist across sessions.** For `SYSTEM` workspaces the cwd is per-session
  (`{userData}/Data/Agents/{sessionId}` — `AgentWorkspaceService.ts:144`). Identity/memory written
  there is thrown away when the session ends.
- **Identity pollutes the user's project folder.** For `USER` workspaces (a real project folder),
  a soul agent writes `SOUL.md`/`memory/` straight into the user's directory.

**Goal:** give every agent a stable, app-owned **root directory** that holds identity + memory,
separated from the per-session/project **working directory**. Each agent acquires its root
transparently (no UI, no user action).

## 2. Target model

| Concern | Directory | Lifetime | Holds |
|---|---|---|---|
| **Agent root** (new) | `{userData}/Data/Agents/Roots/{agentId}` | per-agent, stable | `SOUL.md`, `USER.md`, `system.md`, `memory/` |
| **Working dir** (`cwd`, unchanged) | `session.workspace.path` | per-session / project | task working files, `.claude/skills`, `.claude/plugins.json` |

Why this split is clean:

- **Reads need no fs access.** `SOUL.md`/`USER.md`/`FACT.md` are inlined into the system prompt by
  `PromptBuilder` (main-process fs read), so the agent reads them from context, not from disk.
- **Memory writes already take a path.** `WorkspaceMemoryServer` writes `FACT.md`/`JOURNAL.jsonl`
  with raw `fs` to whatever path it's constructed with — point it at the root.
- **Skills/plugins must stay in `cwd`.** The Claude Agent SDK auto-discovers `.claude/skills` and
  `.claude/plugins.json` from `cwd`. These stay in the working directory (SDK constraint); only
  identity + memory move to the root.

## 3. Scope (confirmed against live code)

- The only **live** identity/memory path is **Soul Mode**: `PromptBuilder.buildSystemPrompt` and the
  `agent-memory` MCP server are both injected for `soul_enabled` agents only
  (`settingsBuilder.ts:773, 825-847`).
- `PromptBuilder.buildFactsSection` (non-soul FACT.md recall) is **dead code** — defined but never
  called from the runtime. Out of scope; left untouched.
- Therefore root separation touches the **soul-mode** wiring plus a uniform path/file helper. No
  non-soul changes.

## 4. Data design — derive, don't store

The root is **derived from `agentId`**; no schema column, no DB migration:

- New path-registry key `feature.agents.roots` → `path.join(appUserDataData, 'Agents', 'Roots')`
  = `{userData}/Data/Agents/Roots` (nested under the existing `feature.agents.workspaces` =
  `Data/Agents`). Safe because nothing enumerates `Data/Agents/*`, and the only consumer of that dir
  — `assertSystemWorkspacePath` (`settingsBuilder.ts:400`) — only validates *system-workspace
  candidate* paths (`Data/Agents/{sessionId}`), never roots, and a `sessionId` is never the literal
  `Roots`.
- Per-agent root = `agentRootPath(rootsBaseDir, agentId)` = `path.join(rootsBaseDir, agentId)`.
- Created lazily (`mkdir -p` + `memory/`) on first session run, exactly like system workspaces.

A column would only add user-relocatable roots, which nobody requested. Derivation is the
"transparent" requirement.

## 5. Unified agent-root module (shared by runtime + migrator)

A **single, pure** module owns the agent-root file contract so the layout isn't re-encoded in five
places (`seedWorkspace.ts`, `prompt.ts`, `WorkspaceMemoryServer`, `BuiltinAgentProvisioner`, and the
migrator). **No** generic migration-framework file primitive — there's only one use case and every
existing migrator handles fs differently on purpose.

**Home:** `src/main/utils/agentRoot.ts` (next to existing `agentWorkspacePath.ts`). It MUST NOT
import `application`/lifecycle — migration runs before the lifecycle is up, and
`MigrationPaths.ts:1-13` warns that calling `app.getPath('userData')` during migration corrupts
users with a custom data dir. So the module is **base-dir-parameterized**; each caller supplies its
own base:

```ts
// src/main/utils/agentRoot.ts — pure, no app singleton
export const IDENTITY_FILES = ['SOUL.md', 'USER.md', 'system.md'] as const
export const MEMORY_DIRNAME = 'memory'

export function agentRootPath(rootsBaseDir: string, agentId: string): string
export async function ensureAgentRoot(rootDir: string): Promise<void>            // mkdir root + memory/
export async function importIdentityAndMemory(srcDir: string, rootDir: string): Promise<string[]>
//   copy IDENTITY_FILES (case-insensitive) + memory/ from srcDir → rootDir,
//   skip-if-dest-exists, best-effort (log + continue on error), returns copied names
```

- **Runtime** callers: `agentRootPath(application.getPath('feature.agents.roots'), agent.id)`.
- **Migration** caller: `agentRootPath(ctx.paths.agentRootsDir, newId)`.

Template content (`SOUL_TEMPLATE`/`USER_TEMPLATE`, the bootstrap-only seeding) stays in
`ai/agents/cherryclaw/seedWorkspace.ts` but writes into the **root** and reuses the file-set/paths
from the util.

## 6. Runtime changes

All in `src/main/ai/runtime/claudeCode/settingsBuilder.ts` + `ai/agents/cherryclaw/prompt.ts`:

1. **Resolve + ensure root once** in `buildClaudeCodeSessionSettings` (where `agent` + `cwd` are
   both available, ~`:254-261`):
   ```ts
   const agentRoot = agentRootPath(application.getPath('feature.agents.roots'), agent.id)
   await ensureAgentRoot(agentRoot)
   ```
2. **System prompt** — thread `agentRoot` into `buildSystemPrompt(session, agent, cwd, agentRoot)`;
   the soul branch (`:773-776`) calls `promptBuilder.buildSystemPrompt(agentRoot, agentConfig)`.
   `provisionBuiltinAgent(cwd, …)` stays on `cwd` (skills/.claude live in cwd for SDK discovery).
3. **`PromptBuilder`** (`prompt.ts`) — `buildSystemPrompt` / `buildMemoriesSection` take the root;
   `memoriesTemplate(rootDir, …)` points the prompt text at the absolute root path; `system.md`
   resolves from the root.
4. **Memory MCP** (`:846`) — `new WorkspaceMemoryServer(agent.id, agentRoot)` instead of
   `session.workspace.path`.
5. **SDK file access for bootstrap `Edit`** — add `additionalDirectories: [agentRoot]` to the
   settings object (`:295-319`) so the agent can `Edit` `SOUL.md`/`USER.md` in the root (which is
   outside `cwd`).
   - ⚠️ **Verify** the exact SDK option name/behavior against the installed
     `@anthropic-ai/claude-agent-sdk` `Options` at implementation (node_modules not present in this
     worktree; not referenced elsewhere in repo). **Fallback** if unavailable: route `SOUL.md`/
     `USER.md` writes through the memory MCP server (add identity read/write actions) so the SDK
     never needs out-of-cwd file access.
6. **Seed templates** — call `seedIdentityTemplates(agentRoot)` in the soul branch (revives the
   currently-dead seeder, now targeting the root) so the bootstrap prompt's "empty templates" are
   real.

## 7. v1 migration (required)

### Ground truth from `origin/v1`

- v1 **does** ship soul/memory: `seedWorkspaceTemplates` runs in production
  (`AgentService.ts:103-105, 386-388`) for `soul_enabled` agents.
- It writes into **`agent.accessible_paths[0]`** — an **agent-level** path. v1's default is
  `{userData}/Data/Agents/{last-9-chars-of-agentId}` (`BaseService.ts:277`), a per-agent app-owned
  dir. Only `AgentService` seeds (not `SessionService`), so the source is unambiguous.
- **Every v1 agent id is remapped** during migration to a fresh `uuidv4` (`remapAgentPrefixIds.ts:50-55`):
  user agents are `` `agent_${Date.now()}_…` `` (`agent_*`), defaults are `cherry-claw-default` /
  `cherry-assistant-default` — all three patterns are covered. So **`v2 agentId ≠ v1 agentId`,
  always.**

### Consequence

The v1 soul/memory dir is keyed by the **old** id and **cannot** be reconstructed from the v2 id.
Under root separation, the runtime reads identity from `Agents/Roots/{newId}` (empty) → **v1 soul/memory
is stranded** unless migration copies it. The source path is recoverable from
`agents_legacy.agents.accessible_paths[0]` (stored verbatim, never mutated).

### The migration step

Add to `AgentsMigrator.execute`, **after** `remapAgentPrefixIds` (`:181`) and **before**
`DETACH agents_legacy` (`:205`):

1. `remapAgentPrefixIds` returns its `Map<oldId, newId>` (it already builds the pairs in its loop).
2. For each soul-enabled legacy agent (read `id`, `accessible_paths`, `configuration.soul_enabled`
   from `agents_legacy.agents`):
   ```ts
   const newId = idMap.get(oldId) ?? oldId           // ?? covers a (non-existent in v1) bare-uuid agent
   await importIdentityAndMemory(accessiblePaths[0], agentRootPath(ctx.paths.agentRootsDir, newId))
   ```
3. **Copy, not move** — `accessible_paths[0]` may be a user folder; v1 is throwaway. Originals become
   harmless leftovers. Idempotent (skip-if-exists) and best-effort (a locked/missing file logs and
   continues — never fails the migration).

### Why an in-memory map is enough (no durable table)

`MigrationEngine` **clears all v2 tables and rebuilds from the immutable v1 sources on every run**
(`MigrationEngine.ts:354`, "clearing for fresh migration"); `agents.db` is never mutated. So every
run re-derives the full `oldId→newId` map from pristine source ids, and the copy runs in the same
`execute()` pass. A failed-then-retried run may leave an orphaned `Agents/Roots/{previousUuid}` dir
(harmless litter), but the final state is always internally consistent.

### Supporting changes

- `MigrationPaths`: add `agentRootsDir: path.join(currentUserData, 'Data', 'Agents', 'Roots')`
  (`MigrationPaths.ts:166-180`) + interface field.
- `remapAgentPrefixIds`: return `Map<oldId, newId>`.
- `AgentsMigrator.validate`: optionally assert copied-root count for soul agents (best-effort; not a
  hard gate, since physical copy failures are non-fatal by design — mirror `FileMigrator`'s
  warn-don't-fail stance on missing physical files).

## 8. Implementation order (each step independently verifiable)

1. **`src/main/utils/agentRoot.ts`** (pure helper) + unit tests → verify: `agentRootPath`,
   `ensureAgentRoot`, `importIdentityAndMemory` (copy/skip/best-effort) pass.
2. **Path registry** `feature.agents.roots` → verify: `application.getPath('feature.agents.roots')`
   resolves; registry tests pass.
3. **Runtime wiring** (settingsBuilder + PromptBuilder + WorkspaceMemoryServer + seed +
   `additionalDirectories`) → verify: soul-agent session reads SOUL/USER/FACT from root; memory tool
   writes land in root; existing `prompt.test.ts` updated to root paths and passes.
4. **Migration** (`MigrationPaths.agentRootsDir`, `remapAgentPrefixIds` returns map, copy step in
   `AgentsMigrator`) → verify: `AgentsMigrator` tests with a seeded soul agent + on-disk
   `SOUL.md/USER.md/memory/` at `accessible_paths[0]` land copies under `Agents/Roots/{newId}`;
   idempotent on re-run.
5. **`pnpm lint && pnpm test && pnpm build:check`**.

## 9. Breaking change

On-disk relocation of agent identity/memory from the working directory to `Data/Agents/Roots/{agentId}`.
v1 upgraders' data is copied by the migrator; the working directory is left intact. Add an entry under
`v2-refactor-temp/docs/breaking-changes/`.

## 10. Decisions (settled)

1. **Scope** — soul-mode only (the only live identity/memory path). `buildFactsSection` dead → left alone.
2. **SDK access** — `additionalDirectories: [agentRoot]` (verify option; MCP-write fallback).
3. **`cwd`** — unchanged (`session.workspace.path`).
4. **v1 migration** — required copy step via the shared `importIdentityAndMemory`, driven by
   `ctx.paths.agentRootsDir` + the remap map; copy-not-move; idempotent; in-memory map (no durable table).
5. **No** pre-seed of `SOUL.md` from v1 `instructions` (instructions already flow via the standard
   append path; soul is opt-in bootstrap; v1 soul agents already have real `SOUL.md`).
6. **No** generic migration file-copy framework.
