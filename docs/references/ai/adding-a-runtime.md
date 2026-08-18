# Adding an Agent Runtime

How to add a third agent runtime alongside `claude-code` and `pi`. For the
host/driver architecture itself (turn lifecycle, resume tokens, follow-up
queue) read [Agent Session Runtime](./agent-session-runtime.md) first — this
document is the operational checklist.

The host (`AgentSessionRuntimeService`) is type-agnostic: it dispatches on
`agent.type` through `runtimeDriverRegistry` and never branches on a concrete
runtime. Renderer UI is descriptor-driven: it reads
`AGENT_RUNTIME_CAPABILITIES[agent.type]` and never branches on a concrete
runtime either. Adding a runtime therefore means **one shared descriptor
entry plus one main-process driver package** — no host or renderer rewrites.

## What the compiler and tests enforce

Most registration points fail loudly if you miss them:

| Point | Enforced by |
|---|---|
| `AGENT_RUNTIME_CAPABILITIES` entry | `satisfies Record<AgentType, AgentRuntimeCapabilities>` — compile error on a missing key |
| Driver registration in `registerDrivers.ts` | `src/main/ai/runtime/__tests__/registerDrivers.test.ts` — every `AgentType` must resolve to a registered agent-session driver |
| Descriptor structural invariants | `src/shared/ai/__tests__/agentRuntimeCapabilities.test.ts` |
| i18n keys present in all locales | `pnpm i18n:check` (part of `pnpm build:check`) |

The only registration points *nothing* enforces are the design rules at the
bottom of this document — read them.

## Step 1 — shared layer

1. **Extend the type.** Add the literal to both:
   - `AgentType` in `src/shared/data/types/agent.ts`
   - the `type: z.enum([...])` in `src/shared/data/api/schemas/agents.ts`

2. **Add the capability descriptor** in
   `src/shared/ai/agentRuntimeCapabilities.ts`. This single entry drives all
   generic renderer behavior — the runtime selector option, the
   permission-mode choices, whether the edit dialog shows model tiers / Soul /
   MCP / skills, the create-dialog defaults, builtin slash commands, the model
   picker filter, the transport tag, and the builtin-tools catalog:

   - `permissionModes` — only modes the runtime actually honors. Don't list
     `plan` if the runtime has no plan mode.
   - `createDefaults.permissionMode` — choose from the runtime's actual trust
     roots and approval policy; see the permission rule below.
   - `isModelCompatible(provider, model)` — `provider` is `undefined` for
     orphan models (provider deleted / not yet loaded); decide fail-open vs
     fail-closed explicitly and say why in a comment. A runtime that needs
     provider endpoint config to drive the model must fail closed.
   - `transport` — a unique tag stamped on every tool part by your stream
     adapter (`providerMetadata.cherry.transport`); the renderer uses it to
     route tool parts to the right card renderer.
   - `builtinTools()` — the edit-dialog catalog. If the runtime ships its own
     tool set, define the descriptors in one shared module (pattern:
     `src/shared/ai/piBuiltinTools.ts`) carrying name, category, **and**
     approval default, and derive everything else from it.

3. **Add i18n keys** in `src/renderer/i18n/locales/{en-us,zh-cn,zh-tw}.json`:
   the runtime option label (`labelKey`) and `agent.tools.builtin.<id>.*` entries for each
   builtin tool. `pnpm i18n:sync` scaffolds missing keys.

## Step 2 — main-process driver package

Create `src/main/ai/runtime/<name>/` implementing the contract in
`src/main/ai/runtime/types.ts`:

1. **Driver** (`AgentSessionRuntimeDriver`) — required members:
   - `type` (the `AgentType` literal) and `capabilities: ['agent-session']`
   - `validateSession(session)` — throw if the session can't be served
     (missing workspace, agent, model, unusable provider). Must be
     **side-effect free**: it runs on every dispatch, so it must not consume
     API-key rotation, open connections, or write state.
   - `listAvailableTools(mcpIds)` — the tool catalog for approval UI.
   - `connect(input)` — build an `AgentRuntimeConnection`.
   - Optional: `prewarmSession` / `closeSessionWarm` / `onSessionIdle` for
     runtimes that benefit from idle warmup (see the Claude driver).

2. **Connection** (`AgentRuntimeConnection`) — required members:
   - `events` — an `AsyncIterable<AgentRuntimeEvent>`. Minimum viable event
     mapping: `chunk` for streamed content, `turn-complete` to settle the
     host turn (the host closes the UI turn on this event — a runtime that
     never emits it strands the turn), `resume-token` whenever the runtime
     learns a recovery handle, `error` on failure.
   - `send(input)` — deliver a user message; `input.systemReminder` marks a
     steer, wrap it with `wrapSteerReminder(...)`.
   - `reconcile(input)` — re-derive the desired connection state. Serialize concurrent
     calls per connection; hot-apply safe policy facts before returning `rebuild` for
     spawn-frozen differences, freeze permission-mode changes during an active turn,
     and return `failed` when a live tightening cannot be applied so the host fails closed.
   - `close()`.
   - Optional, with host fallbacks when omitted:
     - `redirect(input)` — native mid-turn steering; without it the host
       queues follow-ups as the next turn. If implemented, you must emit
       `steer-boundary` when a steer is injected and `steer-undelivered` for
       steers the turn ended before injecting.
     - `getContextUsage()` — live context-window stats; without it the UI
       simply has no usage meter.
     - `compaction-start` / `compaction-complete` / `compaction-error`
       events if the runtime compacts its own history.

3. **System prompt adapter** — call the runtime-neutral
   `buildAgentRuntimePrompt()` from `src/main/ai/runtime/agentPrompt.ts`, then map its
   `{ base, append }` result into the SDK's native prompt representation. Pass resolved
   channel state and capability-gated citation guidance into the common materializer.
   Do not copy instruction precedence, built-in Agent fallback/provisioning, prompt-variable
   resolution, channel security, artifact reporting, or language guidance into the driver.
   Keep only native mechanics in the adapter: the SDK base prompt, cwd/project-context
   carrier, tool snippets, skills transport, and the representation of base/append.
   See [System prompt ownership](./agent-session-runtime.md#system-prompt-ownership).

4. **Stream adapter** — convert runtime-native events into
   `UIMessageChunk`s. Import your transport constant from the descriptor
   (single source), never re-declare the string. Reference implementations:
   `claudeCode/streamAdapter.ts`, `pi/piStreamAdapter.ts`.

5. **Register the driver** in `src/main/ai/runtime/registerDrivers.ts`
   (called from `AgentSessionRuntimeService.onInit`). Do **not** create a
   side-effect `register.ts` module — an unimported side-effect module is
   how pi's registration was silently lost in a merge.

6. **Path keys** — if the runtime needs disk state (config home, session
   files), add `feature.agents.<name>.*` keys to the path registry
   (`src/main/core/paths/`) instead of building paths ad hoc.

## Step 3 — renderer

Usually **nothing**. Selector options, edit/create dialogs, slash commands,
model filtering, and transport routing all derive from the descriptor. The
known exceptions, only if you need them:

- Bespoke tool-card rendering: `src/renderer/components/chat/messages/tools/`
  keys card renderers by transport tag; a new runtime's tool parts render
  with the generic card until you add specific ones.
- `useAgentTools.ts` surfaces MCP-origin tools for the runtimes that bridge them
  (claude-code and pi) plus the Claude built-in registry tools (claude-code
  only); it returns `[]` for any other runtime. Built-in tool catalogs come from
  the descriptor instead.

## Design rules (learned from the pi integration)

These are the choices nothing enforces:

- **Cherry prompt policy is runtime-neutral.** Every driver must consume
  `buildAgentRuntimePrompt()` rather than assembling its own Cherry policy. A runtime may
  supply native workspace/context mechanics, but it may not omit or fork instruction authority,
  built-in Agent resolution, channel security, citation/artifact guidance, or response language.
  Add common policy in the materializer and test that each driver carries it.
- **Runtime-native tool identity.** Keep the runtime's own tool names and
  casing everywhere (catalog ids, `disabledTools` write-back, approval
  lookups). Renaming to another runtime's convention corrupts policy lookups.
- **Approval defaults live with the tool descriptor.** One table carrying
  name + category + approval; a side lookup with a `?? 'auto'` fallback means
  a newly added tool silently becomes auto-approved (fail-open).
- **Credentials never enter runtime config.** If the runtime persists or
  interpolates its config (env expansion, `$VAR` syntax), write a placeholder
  and inject the real key at runtime through the SDK's auth API. Rotate keys
  per connection, not per validation.
- **Fail-closed resource discovery, by trust class.** Do not let the runtime
  auto-import user-global resources or workspace **executable/code** resources
  (extensions, skills, prompt files) until Cherry has an explicit trust flow.
  Workspace **text** the user already vouched for by hand-picking the workspace
  (context files like `AGENTS.md`/`CLAUDE.md`) may load — pi does, matching the
  claude driver's `project` source. Draw the line at the trust class, not at
  "all workspace resources": widening the runtime's `no*` flags wholesale is the
  regression to guard against. See
  [pi driver resource boundary](./agent-session-runtime.md#pi-driver-resource-boundary)
  for the concrete enforcement pattern.
- **Permission posture matches the trust roots.** `claude-code` defaults to
  `default`, with its SDK brokering tool execution. An in-process
  runtime may default to `acceptEdits` only when automatic writes are confined
  to canonical user-selected roots; shell, external paths, third-party tools,
  symlink escapes, and Cherry approval-required mutations must remain gated.
- **Resume tokens are opaque to the host but not to you.** Persist a stable
  runtime id as the resume handle and resolve it under the Cherry-owned session
  directory at open time; never persist absolute paths, because DB-stored paths
  pin that directory forever. Validate the handle before using it to locate a
  session file.

## Verification

- `pnpm test` — includes the registry-pairing and descriptor-invariant tests.
- `pnpm typecheck:node && pnpm typecheck:web`
- `pnpm build:check` before committing (covers i18n and doc links).
- Manual smoke: create an agent of the new type (selector shows the label),
  open a session, run a turn with a mutating tool (approval prompt
  appears), send a mid-turn follow-up (steers or queues per your `redirect`
  support), restart the app and resume the session.
