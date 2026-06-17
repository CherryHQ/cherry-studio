# Declarative Claude Code Tool Registry

> Design doc. Status: approved, implementation in progress (PR-by-PR).

## Context

The Claude Code agent tool set is **hand-written and duplicated across 3+ drifting places**, assembled from disconnected mechanisms:

- `src/shared/ai/claudecode/builtinTools.ts` — `claudeCodeBuiltinTools` (13 tools; policy + edit-dialog catalog). Stale (lists removed `MultiEdit`/`NotebookRead`, omits `Agent`/`BashOutput`/…).
- `src/renderer/.../tools/agent/types.ts` — `AgentToolsType` (~29 names) + per-tool input/output types (type-only import from `@anthropic-ai/claude-agent-sdk/sdk-tools`).
- `src/renderer/.../tools/agent/toolRendererRegistry.tsx` + icon/label switches in `ToolHeader.tsx`.
- `src/shared/ai/claudecode/constants.ts` — `GLOBALLY_DISALLOWED_TOOLS`, `SOUL_MODE_DISALLOWED_TOOLS` (mode-gated, not tool-granular).
- **In-process MCP servers**, each gated differently in `settingsBuilder.buildMcpServers()`: `cherry-tools` (always), `claw` (cron/notify/config — **soul only**), `agent-memory` (memory — **soul only**), `assistant` (assistant only), `skills` (**defined but wired nowhere**).

Goal: **one declarative registry** = single source of truth for policy (main), catalog UI (renderer), and chat rendering (renderer), covering **both SDK-native and in-process MCP tools**, classified **at tool granularity** (no all-or-nothing soul gating; some tools gated by **runtime conditions**). Plus: upgrade the SDK for the Workflow tool, make the toggle a real enable/disable, categorize + i18n the UI.

## Decisions

1. **Hand-authored registry + CI drift guard** (pure import from `sdk-tools.d.ts` impossible — type-only).
2. **Upgrade SDK `0.3.145` → `0.3.168`**. **Workflow stays available** (the motivating feature).
3. **Declarative `exposure`** per tool: `user` (shown, toggleable) · `internal` (always on, hidden) · `conditional` (on iff a runtime predicate holds, hidden) · `disabled` (always blocked). Plus `pairGroup` for atomic pair toggling.
4. **Built-in toggle = real enable/disable** via SDK `disallowedTools` (hard block). **Per-tool approval removed** — approval governed solely by `permission_mode` cards.
5. **App in-process tools fold into the built-in tab** by `category`.
6. **Single opt-out `disabledTools` JSON column** (empty = all enabled). **`allowedTools` retired**.
7. Categories: `shell | file | search | orchestration | media | context`. **`context`** = tools that feed the agent external/persistent context: web, knowledge, memory, skills, notes(future). `search` keeps only local `Glob`/`Grep`.
8. **Drop soul-mode tool gating; classify at tool granularity.** Soul mode's non-tool effects (prompt personality) are out of scope.
9. **Final classifications:**
   - `NotebookEdit` → **disabled** (not needed). `TodoWrite` → **disabled** (superseded by `Task*`).
   - `Agent` + agent-teams (`SendMessage`/`TeamCreate`/`TeamDelete`) → **internal**. `Workflow` → **user**.
   - `ScheduleWakeup`/`RemoteTrigger`/`Monitor`/`PushNotification` → **disabled** (CLI-oriented).
   - `EnterWorktree`/`ExitWorktree` → **conditional** (`workspace-has-git`), pair-grouped.
   - claw `cron` → **user**; `agent-memory` `memory` → **user**; `skills` → **internal** (and newly wired); claw `notify` + `config` → **conditional** (`agent-has-channel`).

## Architecture — 3 layers

### Layer 1 — shared descriptor (new `src/shared/ai/claudecode/toolRegistry.ts`)
```ts
export type ClaudeToolCategory = 'shell' | 'file' | 'search' | 'orchestration' | 'media' | 'context'
export type ClaudeToolExposure = 'user' | 'internal' | 'conditional' | 'disabled'
export type ClaudeToolCondition = 'workspace-has-git' | 'agent-has-channel'
export type ClaudeToolPairGroup = 'worktree' | 'planMode' | 'bash' | 'taskCluster' | 'mcpResource'

interface ClaudeToolDescriptorDef {
  name: string                 // runtime tool name == write-back id (SDK bare name, or mcp__server__wire)
  category: ClaudeToolCategory
  exposure: ClaudeToolExposure
  condition?: ClaudeToolCondition          // required iff exposure==='conditional'
  pairGroup?: ClaudeToolPairGroup
  labelKey: string; descriptionKey: string // i18n keys
  kind: 'sdk' | 'mcp'
  sdkTyped?: boolean           // kind:'sdk'; false = runtime/experimental, absent from ToolInputSchemas (teams); guard skips
  mcpServer?: 'cherry-tools' | 'claw' | 'agent-memory' | 'skills'  // kind:'mcp'
  mcpWireName?: string
}
export const CLAUDE_TOOL_REGISTRY = { /* … */ } as const satisfies Record<string, ClaudeToolDescriptorDef>
export type ClaudeToolKey = keyof typeof CLAUDE_TOOL_REGISTRY
```
Approval metadata dropped (decision #4). `AgentToolsType` derived from the registry.

### Layer 2 — renderer binding (new `agent/toolBinding.tsx`)
`TOOL_UI_BINDINGS satisfies Record<ClaudeToolKey, { icon; render? }>` — compile-time coverage guard. Replaces `toolRenderers` + `ToolHeader` switches; `UnknownToolRenderer` stays as fallback.

### Layer 3 — policy & MCP injection (main)
- `useAgentTools.ts` + `agentTools.ts` source descriptors from the registry.
- `settingsBuilder.buildToolPermissions()` → `resolveDisallowedTools(agent, ctx)`.
- `settingsBuilder.buildMcpServers()` injects an in-process server iff ≥1 of its tools is effectively enabled (replaces the `if (soulEnabled)` gates; wires `skills`).

## Enable/disable model

- New Drizzle column `disabledTools: text({mode:'json'}).$type<string[]>().notNull().default('[]')` in `agent.ts`; add to `AgentBaseSchema` + `AGENT_MUTABLE_FIELDS`.
- `resolveDisallowedTools(agent, ctx)` in `toolRegistry.ts`, where `ctx = { workspaceHasGit: boolean; agentHasChannel: boolean }` (resolved in main: `.git` stat on cwd; `channelService.listChannels`):
  1. `exposure:'disabled'` → always disallowed (subsumes `GLOBALLY_DISALLOWED_TOOLS`; delete that constant).
  2. `exposure:'internal'` → never added.
  3. `exposure:'conditional'` → disallowed iff its `condition` predicate is **false** in `ctx`.
  4. `exposure:'user'` → disallowed iff its name or any `pairGroup` sibling is in `agent.disabledTools`.
  5. **pairGroup atomicity** — re-expand groups (a disabled/condition-false member disables the whole group, incl. internal siblings).
  6. `kind:'mcp'` disabled tools also drop from `adjustAllowedToolsForMcp`'s ensure-list + add `mcp__server__wire` to disallowed.
- `SOUL_MODE_DISALLOWED_TOOLS` + `soul_enabled` server gates **removed**, replaced by per-tool exposure. Assistant-mode `AskUserQuestion` disable stays as a thin overlay.
- `allowedTools` retired (UI stops writing; backend passes empty → SDK permits all, gated by `canUseTool` + `disallowedTools`).

## Approval & ToolApprovalRegistry
Approval = `permission_mode` cards + read-only default-safe set. **Round-trip unchanged.** A disabled/condition-false tool is in `disallowedTools` → removed from context → never reaches `canUseTool` (cover with a test).

## CI drift guard
- **Removals** → typecheck failure (named SDK-type imports + `_sdkCoverage` assertion per `kind:'sdk' && sdkTyped` key).
- **Additions** → `scripts/check-claude-tools.ts` (mirrors `scripts/check-i18n.ts`): parse `ToolInputSchemas`/`ToolOutputSchemas` member identifiers via TS compiler API, strip `Input`/`Output`, apply SDK→name alias map, diff vs registry `kind:'sdk' && sdkTyped` keys → CI fails on any unmapped new SDK builtin.
- `sdkTyped:false` (teams) + `kind:'mcp'` tools are hand-tracked, exempt from the union guard.

## Final classification

### SDK-native (`kind:'sdk'`)
| Tool | category | exposure | pair | note |
|---|---|---|---|---|
| Bash | shell | user | bash | |
| BashOutput | shell | internal | bash | |
| Read / Edit / Write | file | user | | |
| NotebookEdit | file | disabled | | |
| Glob / Grep | search | user | | |
| Agent | orchestration | internal | | subagent spawn |
| SendMessage / TeamCreate / TeamDelete | orchestration | internal | | `sdkTyped:false` (teams, runtime flag) |
| Task | orchestration | internal | | legacy render-only alias |
| TaskCreate/Get/Update/List/Stop/Output | orchestration | internal | taskCluster | |
| TodoWrite | orchestration | disabled | | |
| ExitPlanMode / EnterPlanMode | orchestration | internal | planMode | |
| EnterWorktree / ExitWorktree | orchestration | **conditional: workspace-has-git** | worktree | |
| AskUserQuestion | orchestration | internal | | assistant overlay disables |
| ToolSearch | orchestration | internal | | |
| ListMcpResources / ReadMcpResource | orchestration | internal | mcpResource | |
| Workflow | orchestration | **user** | | |
| WebSearch / WebFetch (native) | context | disabled | | replaced by cherry |
| REPL | shell | disabled | | |
| CronCreate / CronDelete / CronList | orchestration | disabled | | |
| ScheduleWakeup / RemoteTrigger / Monitor / PushNotification | orchestration | disabled | | |

### In-process MCP (`kind:'mcp'`)
| Tool (wire) | server | category | exposure | note |
|---|---|---|---|---|
| web_search / web_fetch | cherry-tools | context | user | replaces native Web* |
| kb_search | cherry-tools | context | user | |
| kb_list | cherry-tools | context | internal | |
| memory | agent-memory | context | user | cross-session FACT.md/JOURNAL |
| skills | skills | context | internal | newly wired (currently injected nowhere) |
| cron | claw | orchestration | user | app scheduler (≠ SDK Cron*) |
| notify | claw | orchestration | **conditional: agent-has-channel** | IM channel push |
| config | claw | orchestration | **conditional: agent-has-channel** | agent self-config (rename/channels) |

Future: media tools (image gen, audio/video) → `category:'media'`; notes → `category:'context'`.

## PR sequence

- **PR-1 — SDK upgrade 0.3.145 → 0.3.168.** Bump root + 8 native optional deps + verify `asarUnpack`; add new union members' type aliases to `types.ts`. *Verify*: `pnpm typecheck`, app boots, agent runs Bash+Read.
- **PR-2 — shared registry + policy + CI guard (static exposures only).** `toolRegistry.ts`, `resolveDisallowedTools` (treats `conditional` as `internal` for now — no `ctx` yet), `scripts/check-claude-tools.ts`. Rewire `agentTools.ts`/`useAgentTools.ts`. **Snapshot-assert disallowed set == today** for non-soul agents.
- **PR-3 — `disabledTools` column + schema + migration.** Existing agents unaffected (empty set).
- **PR-4 — edit-dialog UI: real enable/disable + category sections + cherry fold-in.** Toggle writes `disabledTools`; group by `category`; one switch per `pairGroup`; show only `exposure==='user'`; drop per-tool approve.
- **PR-5 — i18n.** `agent.tools.<Key>.label/.description` in en/zh-cn/zh-tw; migrate `getAgentToolLabel`.
- **PR-6 — render-registry unification + cleanup.** `TOOL_UI_BINDINGS` + registry-driven `ToolHeader`; delete `builtinTools.ts`.
- **PR-7 — conditional exposure + in-process MCP de-soul-gating.** Introduce the `ctx` predicates (`workspace-has-git` via `.git` stat; `agent-has-channel` via `channelService`); enforce `conditional`. De-soul-gate claw/agent-memory; wire `skills`; inject servers per-tool-enabled; remove `SOUL_MODE_DISALLOWED_TOOLS` + soul server gates. **Behavior change** — explicit before/after, tested.

## Risks

- **`exposure:'disabled'` correctness (high):** WebSearch/WebFetch hard-disabled today; mis-encoding re-grants them. PR-2 snapshot assertion is the safety net.
- **De-soul-gating + conditional (high):** PR-7 changes which agents see claw/memory/skills/worktree. Must be explicit + tested; existing soul agents keep their tools; conditional predicates must be cheap (cache `.git` stat / channel count per session build).
- **`skills` newly wired:** confirm marketplace install/authoring is safe to expose (internal = on for every agent).
- **Teams outside typed union:** `SendMessage`/`Team*` can't be union-guarded; need explicit `internal` entries + bindings or they fall to `UnknownToolRenderer`.
- **Warm-query staleness (low):** `disabledTools`/`ctx` re-key the warm signature; applies next session, not mid-session.
