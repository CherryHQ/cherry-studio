# Agent context — context-chef integration plan

Branch: `feat/agent-context` (off `DeJeune/agent-runtime`).

Pairs with `agent-runtime-cherry-plan.md`. The Cherry plan is about *what
the agent IS*; this one is about *what the agent REMEMBERS and how its
context gets shaped before each LLM call*.

The library being integrated is
[`@context-chef`](https://github.com/MyPrototypeWhat/context-chef) —
specifically the `ai-sdk-middleware` package (transparent middleware on
top of Vercel AI SDK v6+) plus a narrow slice of the `core` package
(`Offloader` + a custom SQLite `VFSStorageAdapter`).

## Decisions confirmed

1. **Integration surface = `ai-sdk-middleware`, not `core` directly.**
   Cherry's `createAgent` from `@cherrystudio/ai-core` does NOT expose
   the `LanguageModel` instance, so `wrapLanguageModel()` is unreachable.
   But every existing feature in `agent/params/features/` already pushes
   middleware into `context.middlewares` via `definePlugin().configureContext()`
   (see `anthropicCache.ts:86`). context-chef rides on the same rail —
   one new feature plugin, no surgery on `Agent.ts` / `createAgent`.

2. **Per-request middleware instance.** Janitor's stateful budget tracking
   matters across iterations *within one user turn* (multi-tool loops).
   It does NOT matter across user turns — Cherry persists each turn's
   final messages to SQLite, so the next turn's history is already
   "post-compression" by construction. No `Map<topicId>` cache needed.
   Matches the existing pattern: every feature creates a fresh middleware
   per `createAgent` call.

3. **Capabilities — three tiers.**

   | Capability        | Default | Why |
   |-------------------|---------|------|
   | `compact`         | ON      | Zero-cost mechanical pruning of reasoning blocks + empty messages |
   | `truncate`        | ON      | Cherry's `shell.exec` / `fs.readFile` / `fs.findGrep` outputs are the immediate pain point |
   | `compress`        | OPT-IN  | Needs a user-chosen compression model (paid call); UI work deferred — see TODO-1 |
   | `dynamicState`    | OFF     | Overlaps with section registry on cadence — see TODO-2 |
   | `skill`           | OFF     | Cherry has its own skills system already wired into ai-sdk Agent (`skillsCatalogSection` + `skills__load` tool) — no plan to switch |
   | `transformContext`| OFF     | Escape hatch; expose only when a real consumer shows up — see TODO-3 |

4. **VFS adapter = SQLite, not filesystem.** Cherry already persists every
   conversation to `message` table. A `vfs_blob` table reuses the same DB,
   gets free cascade-delete via `topicId` FK, and survives restart for
   blobs the user might want to re-open in the renderer. Filesystem-backed
   `.context_vfs/` would be a parallel storage with no UX path.

5. **Skip `core`'s Memory / Pruner / Snapshot / Skill modules.**
   - **Memory** — Cherry has no cross-session KV memory product surface — see TODO-4.
   - **Pruner** — Cherry's `ToolRegistry` + `tool_search` / `tool_inspect`
     / `tool_invoke` / `tool_exec` already implement lazy tool discovery.
     One known gap: KV-cache stability — see TODO-5.
   - **Snapshot/Restore** — User-facing branching is fully handled by
     `branch-navigation` (DAG message tree). No agent-internal speculative
     rollback in the pipeline today — see TODO-6.
   - **Skill** — Cherry's `skills__load` tool is wired in production
     (`builtin/index.ts:30`). Not switching.

6. **`buildSystemPrompt` complements chef, doesn't host it.** The middleware
   capabilities (`compact` / `truncate` / `compress`) are message-layer
   rewrites — they don't fit as system-prompt sections.

   But chef ALSO does its own prompt assembly: middleware inserts
   `skillMessages` (skill instructions as system message) and optionally
   `dynamicState` (placement `'system'` adds a system message after the
   conversation). These sit *below* user system messages — chef's pipeline
   explicitly preserves "user system messages are sacred" and only
   compresses the `conversation` slice.

   Resulting two-layer model:

   ```
   [Cherry section registry → system prompt]  per-turn, KV-cache friendly
     │
     ↓
   [chef-injected skill system message]       per-iteration (we OFF)
     │
     ↓
   [conversation history (post truncate/compact/compress)]
     │
     ↓
   [chef-injected dynamicState system message] per-iteration (we OFF)
   ```

   Section registry stays the per-turn outer layer. chef's per-iteration
   system insertions are a separate slot we don't use today; if/when we
   need per-iteration system state (iteration counter, dynamic budget
   readout), `dynamicState` with `placement: 'system'` is its natural
   home — see TODO-2.

## Implementation roadmap

Three releases stacked; each is independently shippable.

### V1 — MVP context management (Phases A–G)

The minimum that delivers user-visible value. Pure middleware integration.
Compaction, tool-result truncation, optional LLM compression. VFS adapter
backed by SQLite. Three behavior-explainer prompt sections so the model
understands what's happening below it.

```
A. dependency wiring                    ← 0 risk, 1 commit
B. vfs_blob schema + service            ← unblocks D, F
C. Offloader factory                    ← consumes B
D. contextChef feature plugin           ← consumes C, registers in INTERNAL_FEATURES
E. settings surface (Provider-level)    ← gates D from running on every chat
F. renderer: VFS pointer rendering      ← independent, can lag
G. behavior-explainer prompt sections   ← independent of D, both consume same settings
```

### V2 — Designed extensions (Phases H–N)

Each item below was a TODO in V1 and got concrete design work after
parallel exploration. Each ships independently after V1 stabilizes.

```
H. static tool selection per conversation     ← fixes real KV-cache regression (was TODO-5)
I. Assembler invocation via transformContext  ← byte-stable JSON for cache hits (was TODO-11)
J. ToolEntry.truncatable opt-out flag         ← protects citation tools (was TODO-9)
K. compression model picker UX                ← Provider settings panel polish (was TODO-1)
L. per-topic context-management override      ← per-topic settings UI (was TODO-8)
M. Memory module (per-agent SQLite)           ← cross-session agent memory (was TODO-4)
N. tool approval state via dynamicState       ← end-to-end dynamicState validation (TODO-2 #1)
```

### V3 — Truly deferred (still TODO)

Speculative or no concrete consumer today. Listed in the TODO section at
the end with revisit triggers.

- TODO-2: dynamicState integration (5 P1 candidates identified, but each
  needs its own subsystem driver — tool-approval, subagent observability,
  iteration counter, retry counter, token budget)
- TODO-3: transformContext escape hatch (Phase I exercises the pattern;
  no other consumer asking)
- TODO-6: Snapshot/Restore (zero current consumers; branch-navigation
  fully covers user branching)
- TODO-7: XmlGenerator consistency refactor (mechanical, low priority)
- TODO-10: Offloader reconcile lifecycle hook (edge case, polish)


## Phase A — dependency wiring

**Question to settle:** is `@context-chef/ai-sdk-middleware` published to
npm yet?

- If yes → `pnpm add @context-chef/ai-sdk-middleware @context-chef/core`
- If no → workspace link via `pnpm add file:/Users/.../context-chef/packages/ai-sdk-middleware`
  (also for `core`); pin a commit and document in `package.json` comment.

**Compatibility (verified):**
- Cherry: `ai ^6.0.143`, `@ai-sdk/provider ^3.0.8`
- middleware peerDeps: `ai >=6`, `@ai-sdk/provider >=3` ✓
- `core` itself only needs `zod` ✓ (already in Cherry's tree)

No bundler changes expected — both packages are pure ESM TS.

## Phase B — `vfs_blob` schema + service

### Schema

`src/main/data/db/schemas/vfsBlob.ts`:

```ts
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { topicTable } from './topic'

export const vfsBlobTable = sqliteTable(
  'vfs_blob',
  {
    id: uuidPrimaryKeyOrdered(),
    // Filename minted by Offloader: vfs_<timestamp>_<hash>.txt
    filename: text().notNull().unique(),
    // Full blob content (UTF-8 string)
    content: text().notNull(),
    // Optional scoping; topic delete cascades blobs
    topicId: text().references(() => topicTable.id, { onDelete: 'cascade' }),
    // Buffer.byteLength at write time
    sizeBytes: integer().notNull(),
    // Touched on every read; drives Offloader Phase B (LRU) eviction
    lastAccessedAt: integer().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('vfs_blob_filename_idx').on(t.filename),
    index('vfs_blob_topic_id_idx').on(t.topicId),
    index('vfs_blob_last_accessed_idx').on(t.lastAccessedAt)
  ]
)
```

### Migration

`pnpm db:migrations:generate` after schema lands → produces
`migrations/sqlite-drizzle/0021_vfs_blob.sql`.

(Per CLAUDE.md "schemas and drizzle SQL are throwaway" — fine to evolve
mid-development; final migration regenerates pre-release.)

### Service

`src/main/data/services/VfsBlobService.ts`:

```ts
import type { VFSStorageAdapter } from '@context-chef/core'
// implements 4 methods: write / read / list / delete
// + helpers: deleteByTopic(), getStats() for observability
// read() updates lastAccessedAt as a side-effect (LRU)
```

Lifecycle: `BeforeReady` phase (depends on `DbService`), exposed via
`application.get('VfsBlobService')`. ~150 lines including error handling
and tests.

### Tests

- `setupTestDatabase()` per `tests/__mocks__/README.md`
- write → read round-trip
- read updates `lastAccessedAt`
- list returns all filenames
- delete is idempotent (no error on missing)
- `topicId` cascade fires on topic delete

## Phase C — Offloader factory

`src/main/ai/contextChef/createOffloader.ts`:

```ts
import { Offloader } from '@context-chef/core'
import { application } from '@application'

export function createOffloader() {
  return new Offloader({
    threshold: 5000,
    headChars: 500,
    tailChars: 1000,
    adapter: application.get('VfsBlobService'),
    maxAge:   7 * 24 * 60 * 60 * 1000,  // 7 days
    maxFiles: 500,
    maxBytes: 500 * 1024 * 1024,         // 500 MB
    onVFSEvicted: (entry, reason) => {
      logger.debug({ uri: entry.uri, reason }, 'vfs evicted')
    }
  })
}
```

Singleton vs per-feature-call: **per-call**, returned fresh from the
factory, so each user turn gets its own Offloader operating on the shared
`VfsBlobService` table. Eviction state is in-memory in Offloader; on
restart, `Offloader.reconcileAsync()` adopts orphan rows back into its
index. Trigger reconcile once at app boot from a lifecycle hook.

## Phase D — `contextChef` feature plugin

`src/main/ai/agent/params/features/contextChef.ts`:

```ts
import { definePlugin } from '@cherrystudio/ai-core'
import { createMiddleware } from '@context-chef/ai-sdk-middleware'
import type { RequestFeature } from '../feature'
import { createOffloader } from '@/ai/contextChef/createOffloader'

function buildContextChefMiddleware(scope: RequestScope) {
  const settings = scope.provider.settings?.contextManagement
  if (!settings?.enabled) return null

  return createMiddleware({
    contextWindow: scope.model.contextWindow ?? 128_000,

    // Always-on mechanical pruning
    compact: {
      reasoning: 'before-last-message',
      emptyMessages: 'remove'
    },

    // Always-on truncation, falling through to VFS for the tail
    truncate: {
      threshold: settings.truncateThreshold ?? 5000,
      headChars: 500,
      tailChars: 1000,
      storage: createOffloader()  // Offloader implements VFSStorageAdapter contract
    },

    // Opt-in compression — needs a configured cheap model
    compress: settings.compress?.modelId
      ? { model: resolveCompressionModel(settings.compress) }
      : undefined,

    onCompress: (summary, count) => {
      logger.info({ count, summary: summary.slice(0, 100) }, 'context-chef compressed')
    }
  })
}

function createContextChefPlugin(scope: RequestScope) {
  return definePlugin({
    name: 'context-chef',
    enforce: 'pre',
    configureContext: (context) => {
      const middleware = buildContextChefMiddleware(scope)
      if (!middleware) return
      context.middlewares = context.middlewares ?? []
      context.middlewares.push(middleware)
    }
  })
}

export const contextChefFeature: RequestFeature = {
  name: 'context-chef',
  applies: (scope) => Boolean(scope.provider.settings?.contextManagement?.enabled),
  contributeModelAdapters: (scope) => [createContextChefPlugin(scope)]
}
```

### Order in `INTERNAL_FEATURES`

Insert AFTER `staticRemindersFeature` and BEFORE `anthropicCacheFeature`:

```
staticRemindersFeature,        // injects reminder block into prompt
contextChefFeature,            // <-- NEW: compact / truncate / compress
anthropicCacheFeature,         // marks cache breakpoints on the (now stable) prompt
anthropicHeadersFeature,
...
```

**Rationale**: context-chef rewrites messages (compaction, truncation,
compression). Anthropic cache markers must be applied AFTER, on the final
shape, otherwise the cache breakpoint may land on a message that gets
removed.

**Cache cooperation — verified, do not reverse the order.**
chef's middleware adapter (`fromAISDK` / `toAISDK` in
`packages/ai-sdk-middleware/src/adapter.ts`) preserves message-level
`providerOptions` (including Anthropic `cache_control`) losslessly via
an internal `_providerOptions` field. This means cache markers planted
by `anthropicCacheFeature` survive any subsequent middleware that
processes the prompt. Three concrete properties that follow:

1. **chef does NOT plant cache markers itself.** A grep across
   `ai-sdk-middleware/src/` finds zero `cache_control` writes — only
   pass-through. So if anthropicCache runs first, its markers stay; if
   contextChef runs first, the prompt is reshaped before anthropicCache
   even sees it (the chosen order).

2. **chef DOES respect the cache contract internally.** core IR has a
   `_cache_breakpoint?: boolean` field that adapters translate to
   provider-specific markers (Anthropic → `cache_control: { type:
   'ephemeral' }`; OpenAI / Gemini → silently stripped). Middleware
   doesn't use this directly but is aware of it — there's a guard in
   `resolveSkillMessages` that skips empty skill instructions
   specifically to avoid "a needless cache breakpoint between system
   and history".

3. **Compression invalidates per-message cache.** When chef's Janitor
   compresses old messages into a `<summary>` block, those messages'
   original `cache_control` markers vanish with them — the new summary
   message has no marker, and the prefix-cache hit naturally breaks at
   that point. This is correct behavior; chef does not silently
   re-mark summaries as cacheable.

Net result: Cherry's anthropicCache feature and chef are orthogonal
caching layers that compose cleanly under this ordering. Reversing
contextChef and anthropicCache would lose markers placed on messages
that get compacted or truncated away — it'd still be functionally
correct (just slower).

## Phase E — settings surface

The minimum viable toggle lives on the **Provider** (mirrors
`anthropicCache`'s placement). Add to `Provider.settings`:

```ts
contextManagement?: {
  enabled: boolean
  truncateThreshold?: number      // default 5000
  compress?: {
    enabled: boolean
    modelId?: UniqueModelId       // user-picked cheap model
  }
}
```

UI placement: Provider settings page → new "Context management" panel
under the existing "Cache control" section. Three controls:
1. Master switch (enabled)
2. Truncate threshold (number input, default 5000)
3. Compression: enable + model picker (defaults to a known cheap model
   from the same provider if available)

Defer: dynamicState, skill bridge, transformContext — no UI, not in V1.

**Per-topic override**: out of scope for V1. Provider-level toggle is
sufficient to validate the feature; per-topic granularity is purely
additive and can land later under `topic.contextManagement` if demand
materializes.

## Phase F — renderer: VFS pointer rendering

When a tool result gets truncated, the LLM receives:

```
<original head ~500 chars>
... [truncated 23,481 chars; full content at context://vfs/vfs_1715000000_abcd.txt] ...
<original tail ~1000 chars>
```

The renderer should detect this pointer in tool result blocks and offer
a "View full" affordance.

Touch points:
- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/cherry/`
  (existing tool-renderer directory) — add a `<VfsPointer />` inline
  component
- New IPC channel: `vfs:read(filename)` → returns full content from
  `VfsBlobService`
- New hook: `useVfsBlob(uri)` — fetch on demand, cache in `useCache`

Defer if Phase D ships without consumer pressure. Truncation works
without the UI — model gets head + tail + pointer text, agent loops
continue. The UI is for *user inspection*, not agent function.

## Phase G — behavior-explainer prompt sections

Three new sections in `src/main/ai/agent/prompts/sections/`, each with
an `applies` gate keyed off the same `provider.settings.contextManagement`
config that drives Phase D. They're cheap, static, and only inject when
the corresponding chef capability is on.

**Why Cherry section registry, not chef's own prompt slots?**
chef's middleware does insert system messages of its own (skill,
dynamicState), but those run per-iteration. The hint sections below
are *static text per-turn* — putting them in Cherry's section registry
gets them inside the cacheable system prefix marked by
`anthropicCacheFeature`, which the chef pipeline preserves verbatim
(see Phase D "Cache cooperation"). chef's per-iteration system
slots are reserved for content whose VALUE genuinely changes between
iterations within a turn — iteration counter, token-budget readout,
pending tool-approval state, subagent progress, retry counter, etc.
Static hints don't qualify; they're per-turn-stable. (TODO-2 covers
the eventual per-iteration use case.)

### G.1 `vfsRetrievalSection`

When `truncate` is on AND VFS adapter is wired:

```
<context-vfs>
Tool outputs above 5000 characters are automatically truncated. The
full content is preserved and reachable via the URI in the truncation
marker (e.g. `context://vfs/vfs_xxx.txt`). To retrieve full content,
call the `vfs_read` tool with the URI's filename portion.
</context-vfs>
```

Requires: `vfs_read` tool exposed (Phase F's IPC, but exposed as a
builtin tool). Add to `tools/builtin/`.

### G.2 `compactionHintSection`

When `compact.reasoning` aggressively prunes (anything stronger than
`'none'`):

```
<context-compaction>
Earlier reasoning blocks may have been removed to save context budget.
Treat the visible conversation history as canonical; do not refer back
to thinking that is no longer present.
</context-compaction>
```

Always cheap (~30 tokens), no model behavior change without it (model
just gets confused if it tries to reference removed reasoning).

### G.3 `compressionHintSection`

When `compress` is enabled:

```
<context-compression>
Older messages may have been summarized into a `<summary>...</summary>`
block. Treat the summary as authoritative for the events it describes.
</context-compression>
```

### Section ordering

These join the existing `CONTRIBUTORS` array in
`prompts/sections/buildSystemPrompt.ts` AFTER `systemRulesSection` and
BEFORE `toolIntrosSection` — they're behavior contracts, conceptually
sibling to `agentDisciplineSection`.

### Optional XML refactor (separate from G)

`@context-chef/core` exposes `XmlGenerator.objectToXml()`. Existing
sections (`envSection`, `skillsCatalogSection`) build XML by hand. A
follow-up pass could swap them to `XmlGenerator` for consistency. Pure
refactor, no behavior change. Track as TODO-7.

# V2 — Designed extensions

The phases below were investigated in depth after V1 design (see decision
log at the bottom for the parallel-exploration record). Each has a
concrete design ready to implement; ordering is independent — pick by
ROI / urgency.

## Phase H — Static tool selection per conversation (cache stability)

**Problem (verified via source trace).** Cherry's `registry.selectActive(scope)`
runs every request with predicates like:

```ts
// WebSearchTool.ts:114
applies: (scope) => Boolean(scope.assistant?.settings?.enableWebSearch)
// KnowledgeSearchTool.ts:98
applies: (scope) => (scope.assistant?.knowledgeBaseIds?.length ?? 0) > 0
```

Plus `mcpToolIds` from `resolveAssistantMcpToolIds` (DB-fetched per
request). If the user toggles web search OR adds a knowledge base OR
enables/disables an MCP server between turn N and turn N+1, the toolset
shape changes → Anthropic prefix cache misses on EVERY subsequent turn
of the same conversation.

This is a **real regression on top of any chef integration**, because
chef preserves `cache_control` markers but cannot help if the underlying
tool definitions byte-shifted.

**Fix.** Snapshot the toolset at the first message of a conversation;
reuse byte-identical tool definitions for all subsequent turns. Cache
the resolved `ToolSet` in `AiStreamManager` keyed by `topicId`; invalidate
when the user explicitly changes assistant settings.

```ts
// src/main/ai/stream-manager/AiStreamManager.ts (sketch)
private toolsetCache = new Map<string, { tools: ToolSet; signature: string }>()

private async resolveToolset(scope: ToolApplyScope, topicId: string): Promise<ToolSet> {
  const signature = computeToolSignature(scope) // assistantId + mcpServerIds + flags
  const cached = this.toolsetCache.get(topicId)
  if (cached?.signature === signature) return cached.tools
  const fresh = registry.selectActive(scope).map(e => e.tool)
  this.toolsetCache.set(topicId, { tools: fresh, signature })
  return fresh
}

// invalidation: subscribe to PreferenceService events for assistant settings
// changes, drop entries whose assistantId matches.
```

**Out of scope here.** Mid-conversation tool toggles intentionally
invalidate cache — that's correct (user changed the rules). The fix
only stops *spurious* re-resolution that returns the same tools but
recomputes them from scratch.

**Files:**
- NEW: `src/main/ai/stream-manager/toolsetCache.ts`
- MODIFY: `src/main/ai/stream-manager/AiStreamManager.ts`
- MODIFY: `src/main/ai/agent/params/buildAgentParams.ts:138` (consume cache)

**Risk:** low. Cache is keyed by signature, so over-stale tools is
impossible (signature changes invalidate). Memory bound: O(active topics).

### Why not Pruner-style namespacing instead?

Considered: hide all individual tools behind ONE virtual dispatcher
tool (chef Pruner Layer 1 pattern):

```ts
{ name: "tools",
  parameters: { namespace: { enum: [...] }, action: string, args: object } }
```

Tool definition shape would NEVER change → guaranteed byte stability,
stronger than Phase H. But trade-offs are heavy:

- **Overlaps Cherry's existing meta-tools** (`tool_search` /
  `tool_inspect` / `tool_invoke`), which today coexist as an
  *alternative* discovery path — turning them into the ONLY path is
  an architectural shift
- **Model UX regression**: every tool call becomes search → inspect →
  invoke (multiple round trips); known LLM weakness on multi-step
  dispatch
- **Renderer breakage**: `MessageAgentTools/cherry/FsReadTool`,
  `ShellExecTool`, etc. are organized by specific tool name; single
  dispatcher would require redesigning the message-rendering layer
- **Tool approval coupling**: `services/toolApproval/` rules key off
  specific tool names; would need rewrite

Phase H gets ~95% of the cache benefit with ~5% of the change. The
namespacing route stays as a future option (see TODO-12).

## Phase I — Assembler invocation via `transformContext` (key ordering)

**Problem (verified via source trace).** chef's `Assembler.orderKeysDeterministically`
ensures byte-stable JSON for KV-cache hits, but middleware mode does NOT
invoke it. `fromAISDK` / `toAISDK` adapters preserve content but don't
sort keys. AI SDK and provider SDKs (Anthropic, OpenAI) also don't sort
— `JSON.stringify` uses ES2015 insertion order.

**Severity reframe.** This is **defense-in-depth, not a confirmed
regression**. JS object key order in deterministic code paths is
actually stable: if Cherry constructs every message via the same code
with the same keys in the same order, two consecutive turns produce
byte-identical key order naturally. Drift only happens when:

1. Different code branches construct similar messages with different
   key orders (e.g., one path emits `{role, content}`, another emits
   `{content, role}`)
2. Properties get conditionally added based on per-call state (some
   requests carry `providerOptions`, others don't, with different
   spread positions)
3. Multi-feature middleware chains spread messages in inconsistent
   orders

In Cherry's current code, none of these are obviously hit. Phase H
(toolset cache) likely covers the dominant cache-miss source by
itself. **Phase I is insurance against subtle drift, not a known fix.**

**When to actually do Phase I.** After Phase H lands, instrument
Anthropic cache-hit metrics. If hit rate is below ~80% on consecutive
same-conversation turns even with stable settings, Phase I is worth it.
If hit rate is high, defer indefinitely.

**If/when implementing — Fix.** Wire `Assembler.orderKeysDeterministically`
into chef's `transformContext` callback (the documented escape hatch
— exercising TODO-3 for the first real consumer):

```ts
// src/main/ai/agent/params/features/contextChef.ts (Phase D delta)
import { Assembler } from '@context-chef/core'

const middleware = createMiddleware({
  // ... existing options ...
  transformContext: async (prompt) => {
    return prompt.map((msg) => Assembler.orderKeysDeterministically(msg))
  }
})
```

Runs as the LAST step in chef's 8-step pipeline, after all other
rewrites. Output goes straight to the provider SDK.

**Caveat:** This sorts **message-object keys**. Tool definitions inside
the prompt are in `params.tools`, not `params.prompt` — they need their
own pass. Either:
- Apply `orderKeysDeterministically` to the tool array in the same
  feature, OR
- Apply it once at toolset construction time (Phase H is the natural
  home — sort at cache time, store sorted).

Choose the latter: pairs cleanly with Phase H, single normalization
point, sorted-tools cache hits even better than unsorted-tools cache.

**Files:**
- MODIFY: `src/main/ai/agent/params/features/contextChef.ts` (one-line
  `transformContext` addition)
- MODIFY: `src/main/ai/stream-manager/toolsetCache.ts` (sort tools at
  cache insert time, from Phase H)

**Verification.** After landing, log
`crypto.createHash('sha256').update(JSON.stringify(prompt)).digest('hex')`
on consecutive turns of the same conversation; before-fix the hash
varies, after-fix it stabilizes for the cacheable prefix.

## Phase J — `ToolEntry.truncatable` opt-out for citation tools

**Problem (verified).** `WebSearchTool` and `KnowledgeSearchTool` return
arrays of `{ id, content, ... }` items where the model cites results by
`[id]`. chef's `truncate` cuts by char threshold; if it lands mid-array,
the model may reference results that no longer exist in context →
broken citations / hallucinated sources.

**Scope clarification.** chef's `truncate` continues to be the right
default for **shell output, fs.readFile output, fs.findGrep output,
and arbitrary MCP tool output** — those are the largest, most volatile,
non-citation cases where chef is genuinely irreplaceable. Phase J only
carves out the small subset of tools that have explicit citation
contracts; chef value remains intact for the dominant case.

**Two-part fix.**

### J.1 — Upstream: add `truncate.excludeToolNames` to context-chef

**Status**: being implemented in the chef repo in parallel with this
plan (out of band, not tracked as a Cherry-side TODO). When merged and
released, Cherry bumps `@context-chef/ai-sdk-middleware` and J.2 lands.

Currently chef's `truncate` option is shape:

```ts
truncate?: {
  threshold: number
  headChars?: number
  tailChars?: number
  storage?: VFSStorageAdapter
}
```

Propose adding:

```ts
truncate?: {
  // ... existing fields ...
  /**
   * Tool names to skip when truncating tool results. Matches against
   * AI SDK V3's `tool` role messages by `toolName`. Tools listed here
   * pass through untouched regardless of size.
   *
   * Use for tools with citation/grounding contracts where mid-array
   * truncation would break the model's reference integrity (e.g. web
   * search, knowledge search).
   */
  excludeToolNames?: string[]
}
```

Implementation in `truncator.ts` is one conditional:

```ts
for (const part of toolMessageParts) {
  if (excludeToolNames?.includes(part.toolName)) continue
  // ... existing per-result threshold check + truncation
}
```

This is genuinely useful upstream — every chef consumer with citation
tools faces the same problem. Cherry should land this in the
context-chef repo alongside the integration so the ecosystem benefits.

### J.2 — Cherry side: declarative flag + wiring

`ToolEntry` gains the flag:

```ts
// src/main/ai/tools/types.ts
export interface ToolEntry {
  // ... existing fields ...
  /**
   * Whether this tool's output can be truncated by context-chef.
   * Set to false for tools with citation/grounding contracts where
   * result-array integrity is critical (web/kb search).
   * Default: true. Read by the contextChef feature to populate
   * chef's `truncate.excludeToolNames` option.
   */
  truncatable?: boolean
}
```

Two tools opt out:

```ts
// WebSearchTool.ts
export function createWebSearchToolEntry(): ToolEntry {
  return { /* ... */, truncatable: false }
}

// KnowledgeSearchTool.ts
export function createKbSearchToolEntry(): ToolEntry {
  return { /* ... */, truncatable: false }
}
```

contextChef feature reads the registry once at request time and feeds
the list to chef's new option:

```ts
// src/main/ai/agent/params/features/contextChef.ts (Phase D delta)
const excludeToolNames = registry
  .getAll()
  .filter((e) => e.truncatable === false)
  .map((e) => e.name)

const middleware = createMiddleware({
  // ... existing options ...
  truncate: {
    threshold: settings.truncateThreshold ?? 5000,
    headChars: 500,
    tailChars: 1000,
    storage: createOffloader(),
    excludeToolNames  // ← from Cherry registry, passed to chef
  }
})
```

**No tool-author burden in Cherry.** Tools that opt out via flag are
fully responsible for their own output size, but no Cherry-side
orchestration forces them to internally cap. If a citation tool's
output gets unwieldy, that's a separate quality issue for that tool to
address (paginate, drop low-relevance), not something chef should
silently fix mid-flight at the cost of broken refs.

**Files:**
- UPSTREAM: `context-chef/packages/ai-sdk-middleware/src/types.ts` —
  add `excludeToolNames` to `TruncateOptions`
- UPSTREAM: `context-chef/packages/ai-sdk-middleware/src/truncator.ts` —
  honor `excludeToolNames` in the truncate loop
- MODIFY: `src/main/ai/tools/types.ts` (add `truncatable?: boolean`)
- MODIFY: `src/main/ai/tools/builtin/WebSearchTool.ts` (`truncatable: false`)
- MODIFY: `src/main/ai/tools/builtin/KnowledgeSearchTool.ts` (same)
- MODIFY: `src/main/ai/agent/params/features/contextChef.ts` (build
  list from registry, pass to chef)

**Sequencing:** J.1 lands first in the chef repo (already in progress),
gets released, Cherry bumps the dependency, then J.2 lands.

## Phase K — Compression model picker UX

**Problem.** V1 (Phase E) ships `compress` as opt-in with no model
picker UI, requiring users to dive into Provider config. V2 makes it a
first-class panel.

**Pattern reused.** Cherry already has `ModelSelector` component
(`src/renderer/src/components/ModelSelector/ModelSelector.tsx`) used by
`RagSettings.tsx:58–66` for embedding model selection. Same primitive
fits compression model.

**UI sketch (Provider settings page → "Context management" panel):**

```
┌──────────────────────────────────────────┐
│ CONTEXT MANAGEMENT                       │
├──────────────────────────────────────────┤
│ ☐  Enable context management             │
│                                          │
│ Truncate threshold (chars)               │
│ [          5000           ]              │
│ Tool outputs above this size are         │
│ summarized and offloaded to local DB.    │
│                                          │
│ ─── Compression (advanced) ───────────── │
│ ☐  Auto-compress when context fills      │
│                                          │
│ Compression model                        │
│ [Provider ▼]  [Model ▼]                  │
│ Pick a cheap, fast model (e.g.           │
│ gpt-4o-mini, claude-haiku, qwen-turbo).  │
│                                          │
│ Estimated cost: ~$0.001 per compression  │
└──────────────────────────────────────────┘
```

**Default behavior decision: opt-in only, no auto-default model.**

Rationale (overrides earlier "lean toward require pick" — now firm):
- Auto-picking would silently bill on a model the user didn't choose.
- The detection logic ("which model is the cheapest from this provider?")
  is brittle — Cherry has no central catalog mapping providers to their
  cheap-model recommendations.
- Power-user feature; visibility through "Compression (advanced)"
  collapsible is sufficient.

**Files:**
- MODIFY: `src/renderer/src/pages/settings/ProviderSettings/` (find
  the right tab — likely a new `ContextManagementPanel.tsx`)
- MODIFY: `packages/shared/data/types/provider.ts` — extend
  `Provider.settings.contextManagement` schema
- MODIFY: i18n keys for new strings

## Phase L — Per-topic context-management override

**Problem.** V1 puts settings on Provider only. Power users want one
expensive analysis topic to use compression while regular chat doesn't.

**Schema (additive, nullable JSON column).** All fields optional;
undefined = inherit from Provider:

```ts
// packages/shared/data/types/topic.ts
export const TopicContextManagementSchema = z.strictObject({
  enabled: z.boolean().optional(),
  truncateThreshold: z.number().int().positive().optional(),
  compress: z.object({
    enabled: z.boolean(),
    modelId: z.string().optional()
  }).optional()
}).optional()

// Topic table gets:
contextManagement: text({ mode: 'json' })
  .$type<TopicContextManagement>()
  .nullable()
  .default(null)
```

**Resolution rule (in `buildAgentParams`):**

```ts
function resolveContextManagement(topic: Topic, provider: Provider) {
  const provLevel = provider.settings?.contextManagement
  const topLevel = topic.contextManagement
  return {
    enabled: topLevel?.enabled ?? provLevel?.enabled ?? false,
    truncateThreshold: topLevel?.truncateThreshold ?? provLevel?.truncateThreshold ?? 5000,
    compress: topLevel?.compress ?? provLevel?.compress
  }
}
```

**UI.** Cherry has no existing per-topic settings UI yet. Adding one is
its own design exercise; until then, expose via Topic context-menu
("Topic settings → Advanced → Context management") with the same fields
as Phase K, each preceded by an "Inherit from provider" radio:

```
○ Inherit from provider
● Override
  [field]
  [Reset to provider default]
```

**Migration.** Purely additive. Existing topics have `null`, resolution
falls through to provider.

**Files:**
- NEW: `migrations/sqlite-drizzle/00YY_topic_context_management.sql`
- MODIFY: `src/main/data/db/schemas/topic.ts`
- MODIFY: `packages/shared/data/types/topic.ts`
- NEW: `src/renderer/src/pages/home/TopicSettings/ContextManagementOverride.tsx`
  (or wherever per-topic settings will live)

## Phase M — Memory module (per-agent SQLite)

**Scope.** Adopt `@context-chef/core`'s Memory for cross-session agent
memory. Memory injects content into the system prompt during compile
AND auto-registers `create_memory` / `modify_memory` tools.

**Why now (vs deferred).** Cherry has zero cross-session memory product
surface today. Adding it is a feature decision, but the integration is
mostly mechanical given chef does the heavy lifting. ~6 hours estimated.

**MemoryStore interface (verified) — 4 required + 2 optional methods:**

```ts
interface MemoryStore {
  get(key: string): MemoryStoreEntry | null | Promise<MemoryStoreEntry | null>
  set(key: string, entry: MemoryStoreEntry): void | Promise<void>
  delete(key: string): boolean | Promise<boolean>
  keys(): string[] | Promise<string[]>
  snapshot?(): Record<string, MemoryStoreEntry>
  restore?(data: Record<string, MemoryStoreEntry>): void
}
```

### Schema

`src/main/data/db/schemas/agentMemory.ts`:

```ts
export const agentMemoryTable = sqliteTable(
  'agent_memory',
  {
    id: uuidPrimaryKeyOrdered(),
    agentId: text().notNull().references(() => agentTable.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    value: text().notNull(),
    description: text(),
    updateCount: integer().notNull().default(1),
    importance: integer(),
    expiresAt: integer(),       // wall-clock TTL ms
    expiresAtTurn: integer(),   // turn-based TTL
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_memory_agent_key_idx').on(t.agentId, t.key),
    index('agent_memory_expires_at_idx').on(t.expiresAt)
  ]
)
```

**Scoping decision: per-AGENT.** Cherry has no users; agents are the
durable behavior unit. Per-topic memory would fragment knowledge.
`(agentId, key)` should be UNIQUE — enforce via composite index +
upsert pattern.

### Service

`src/main/data/services/AgentMemoryService.ts` — implements `MemoryStore`,
constructed per-agent (`new AgentMemoryStore(agentId)`). ~150 lines.

### Tool registration

Memory's tools register at agent compile time (not Cherry's static
`builtin/index.ts`). In `buildAgentParams.ts` after `resolveTools`:

```ts
if (assistant?.configuration?.memory?.enabled) {
  const store = new AgentMemoryStore(assistant.id)
  const memory = new Memory({ store, allowedKeys: assistant.configuration.memory.allowedKeys })
  const memoryTools = await memory.getToolDefinitions()
  for (const t of memoryTools) {
    activeEntries.push({ name: t.name, tool: createMemoryTool(t.name, memory) })
  }
}
```

### Prompt injection

Memory injects content into the system message during chef's `compile()`.
**In middleware mode this is automatic** — chef internally calls Memory
during pipeline assembly. Cherry doesn't need to manually wire prompt
injection; just ensure `memory: ...` is passed to `createMiddleware`.

### UX

Add "Memory" panel to Agent settings (sibling to existing Skills panel):

```
┌────────────────────────────────────────┐
│ AGENT SETTINGS                         │
├────────────────────────────────────────┤
│ ...                                    │
│ ☐  Enable memory                       │
│                                        │
│ Allowed keys (comma-separated)         │
│ [user_pref, project_rules, conventions]│
│ Leave empty to allow any key.          │
│                                        │
│ Stored memories (3)                    │
│ ┌──────────────────────────────────┐  │
│ │ user_pref                        │  │
│ │ "TypeScript, functional style"   │  │
│ │ Updated 2d ago · count: 3        │  │
│ │ [Edit] [Delete]                  │  │
│ └──────────────────────────────────┘  │
│ ...                                    │
└────────────────────────────────────────┘
```

### Conflict check

- vs `agent_skill` / `agent_global_skill`: skill = behavior bundle,
  memory = data. Orthogonal.
- vs `skills__load` tool: different semantic (load instructions vs
  read/write KV). No collision.
- vs `topic.workspaceRoot`: workspace = path, memory = facts. Orthogonal.

### Files

- NEW: `src/main/data/db/schemas/agentMemory.ts`
- NEW: `migrations/sqlite-drizzle/00ZZ_agent_memory.sql`
- NEW: `src/main/data/services/AgentMemoryService.ts` (+ tests)
- MODIFY: `src/main/ai/agent/params/buildAgentParams.ts` (memory tool
  registration + middleware wiring)
- MODIFY: `src/main/ai/agent/params/features/contextChef.ts` (pass
  `memory` option through to `createMiddleware`)
- MODIFY: `packages/shared/data/types/agent.ts` (extend
  `Assistant.configuration.memory`)
- NEW: `src/renderer/src/pages/agents/components/MemoryPanel.tsx`

## Phase N — Tool approval state via dynamicState

**Why this is in V2 (and not V3 with the rest of TODO-2).**
This is the first concrete consumer of context-chef's `dynamicState`
slot. Wiring it up validates the per-iteration injection chain
end-to-end with the highest-impact UX problem (currently the model
literally cannot tell that an approval just came through). The other
4 candidates from TODO-2 stay V3 to keep PR scope reviewable.

**Problem (verified).** Today the approval lifecycle in
`services/toolApproval/` flips a row to `pending` and
`PersistentChatContextProvider.ts:201–209` rewrites the anchor message's
parts when the user approves/denies. The model sees the rewritten
parts on the next iteration but has zero explicit signal that the
state just changed — it has to infer "did my pending tool call get
greenlit?" from history scanning. In practice the model often:
- Stalls (re-asks for permission)
- Skips ahead without retry-ing the blocked call
- Hallucinates that approval was granted when it was actually denied

### Design

Two small additions:

1. **In-memory observability ring buffer** keyed by `topicId`, holding
   the last N (default 5) approval decisions per topic.
2. **dynamicState `getState()` callback** in the contextChef feature
   that returns `{ pendingApprovals, recentDecisions }`.

State shape:

```ts
type ApprovalDynamicState = {
  pendingApprovals: Array<{
    toolName: string
    toolCallId: string
    requestedAt: string  // ISO 8601
    preview?: string     // first ~80 chars of args, for context
  }>
  recentDecisions: Array<{
    toolName: string
    decision: 'approved' | 'denied'
    decidedAt: string
    reason?: string      // user's optional inline reason
  }>
}
```

### Observability service

`src/main/services/toolApproval/observability.ts`:

```ts
const MAX_RECENT = 5
const recent = new Map<string, ApprovalDecisionEntry[]>()  // by topicId

export function recordDecision(topicId: string, entry: ApprovalDecisionEntry): void {
  const list = recent.get(topicId) ?? []
  list.unshift(entry)
  if (list.length > MAX_RECENT) list.length = MAX_RECENT
  recent.set(topicId, list)
}

export function getApprovalState(topicId: string): ApprovalDynamicState {
  return {
    pendingApprovals: queryPendingFromDb(topicId),  // existing query
    recentDecisions: recent.get(topicId) ?? []
  }
}

// Eviction: drop entries older than 1 hour OR when topic is closed
```

The ring buffer is per-process in-memory. Loss on restart is fine —
`recentDecisions` is a "hint" not source of truth (the actual approved
state is in the message history).

### Wiring into contextChef feature

```ts
// src/main/ai/agent/params/features/contextChef.ts (Phase D delta)
import { getApprovalState } from '@/services/toolApproval/observability'

const middleware = createMiddleware({
  // ... existing options ...
  dynamicState: {
    getState: () => getApprovalState(scope.topicId),
    placement: 'system'  // authoritative — model should weigh this heavily
  }
})
```

Placement `'system'`: chef appends as a system message AFTER the
conversation history, where it gets maximum attention without breaking
the cached prefix.

### Decision recording

Hook into the existing approval decision path (wherever the user's
approve/deny is processed today — likely in
`services/toolApproval/checkPermission.ts` or the IPC handler
upstream of it):

```ts
// On approval/denial, after the existing state mutation:
recordDecision(topicId, {
  toolName,
  decision,
  decidedAt: new Date().toISOString(),
  reason: userReason
})
```

### Pending approvals query

The "pendingApprovals" list comes from existing approval state. If
there's no DB query for "currently pending in this topic", add one
(it's a `WHERE topicId = ? AND status = 'pending'` over whatever table
holds approval rows). Should be a few lines.

### Empty-state behavior

When both lists are empty, `getState()` returns
`{ pendingApprovals: [], recentDecisions: [] }`. chef serializes this
as `<dynamic_state><pendingApprovals/><recentDecisions/></dynamic_state>`
— ~80 tokens of overhead per LLM call when nothing is happening.

To avoid that overhead, **return `undefined` when both are empty**
and let chef skip the injection entirely:

```ts
getState: () => {
  const state = getApprovalState(scope.topicId)
  if (!state.pendingApprovals.length && !state.recentDecisions.length) {
    return undefined
  }
  return state
}
```

(Verify chef respects `undefined` return as "skip injection". If not,
fallback: emit a minimal stub or use feature `applies` gate.)

### Files

**NEW:**
- `src/main/services/toolApproval/observability.ts` (+ tests)

**MODIFY:**
- `src/main/services/toolApproval/checkPermission.ts` (or wherever
  decisions are recorded) — call `recordDecision()` post-mutation
- `src/main/services/toolApproval/index.ts` — export ring buffer
  helpers if needed
- `src/main/ai/agent/params/features/contextChef.ts` — add
  `dynamicState` option to `createMiddleware()`
- `src/main/ai/agent/params/scope.ts` — verify `topicId` is in
  `RequestScope`; add if missing

### Risk

Low. Worst case: `dynamicState` injection fails silently, model
behavior degrades to current state (it figures out approval from
history, which is what happens today). Ring buffer is bounded
(MAX_RECENT × active topics × ~200 bytes = trivially small).

### Tests

- Unit: `recordDecision` ring-buffer eviction at MAX_RECENT
- Unit: `getApprovalState` returns empty when topic has no activity
- Integration: end-to-end approval → next-call dynamicState contains
  the decision

## Open questions

The big ones still need a decision before code lands:

1. **Compression model picker default**: ship with a hardcoded fallback
   (e.g. "gpt-4o-mini" if the active provider is OpenAI-shaped)? Or
   require explicit user pick? Leaning *require pick* — silently billing
   the user for compression on a model they didn't configure is
   surprising. Folded into TODO-1 once decided.

2. **Context window source**: `scope.model.contextWindow` may be unset
   for less-known models. Fallback chain proposal:
   `model.contextWindow → provider default → 128_000 hard floor`.

3. **Reconcile timing**: Offloader's `reconcileAsync()` runs at boot to
   adopt orphan rows. Where in the lifecycle? Probably one-shot at
   `WhenReady` after `VfsBlobService` is up. May want to throttle if
   `vfs_blob` grows large. Tracked as TODO-10.

(Other previously-listed open items are now folded into the TODO list
above — TODO-1, TODO-9, TODO-10.)

## File inventory

### V1 (Phases A–G)

**NEW:**
- `src/main/data/db/schemas/vfsBlob.ts`
- `migrations/sqlite-drizzle/00XX_vfs_blob.sql` (auto-generated)
- `src/main/data/services/VfsBlobService.ts` (+ tests)
- `src/main/ai/contextChef/createOffloader.ts`
- `src/main/ai/agent/params/features/contextChef.ts` (+ tests, mirroring `anthropicCache.test.ts` if present)
- `src/main/ai/agent/prompts/sections/vfsRetrievalSection.ts` (Phase G)
- `src/main/ai/agent/prompts/sections/compactionHintSection.ts` (Phase G)
- `src/main/ai/agent/prompts/sections/compressionHintSection.ts` (Phase G)
- `src/main/ai/tools/builtin/vfs/read.ts` (Phase G — exposes `vfs_read` to the model)
- `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/cherry/VfsPointer.tsx` (Phase F)
- `src/renderer/src/hooks/useVfsBlob.ts` (Phase F)

**MODIFIED:**
- `package.json` — `@context-chef/ai-sdk-middleware`, `@context-chef/core`
- `src/main/ai/agent/params/features/index.ts` — register `contextChefFeature`
- `src/main/ai/agent/prompts/sections/buildSystemPrompt.ts` — register the 3 hint sections in `CONTRIBUTORS`
- `src/main/ai/tools/builtin/index.ts` — register `vfs_read` tool entry
- `packages/shared/data/types/provider.ts` — extend `settings.contextManagement`
- `src/main/core/application/serviceRegistry.ts` — register `VfsBlobService`
- Provider settings page — add "Context management" panel (Phase E)
- IPC channel manifest — add `vfs:read` (Phase F)

### V2 (Phases H–M, additions)

**NEW:**
- `src/main/ai/stream-manager/toolsetCache.ts` (Phase H)
- `src/main/data/db/schemas/agentMemory.ts` (Phase M)
- `migrations/sqlite-drizzle/00YY_topic_context_management.sql` (Phase L)
- `migrations/sqlite-drizzle/00ZZ_agent_memory.sql` (Phase M)
- `src/main/data/services/AgentMemoryService.ts` (+ tests) (Phase M)
- `src/main/services/toolApproval/observability.ts` (+ tests) (Phase N)
- `src/renderer/src/pages/home/TopicSettings/ContextManagementOverride.tsx` (Phase L)
- `src/renderer/src/pages/agents/components/MemoryPanel.tsx` (Phase M)
- New Provider settings panel `ContextManagementPanel.tsx` (Phase K)

**MODIFIED:**
- `src/main/ai/agent/params/features/contextChef.ts` — add `transformContext`
  for Assembler + read `truncatable` flag from registry + pass `memory` and
  `dynamicState` options (Phases I, J, M, N)
- `src/main/ai/stream-manager/AiStreamManager.ts` — wire toolset cache (Phase H)
- `src/main/ai/agent/params/buildAgentParams.ts` — consume cached toolset
  (Phase H) + memory tool registration (Phase M) + per-topic resolution (Phase L)
- `src/main/ai/agent/params/scope.ts` — confirm `topicId` is in `RequestScope` (Phase N)
- `src/main/ai/tools/types.ts` — add `truncatable?: boolean` (Phase J)
- `src/main/ai/tools/builtin/WebSearchTool.ts` — `truncatable: false` (Phase J)
- `src/main/ai/tools/builtin/KnowledgeSearchTool.ts` — `truncatable: false` (Phase J)
- `src/main/services/toolApproval/checkPermission.ts` (or upstream IPC handler)
  — call `recordDecision()` post-mutation (Phase N)
- `src/main/data/db/schemas/topic.ts` — `contextManagement` JSON column (Phase L)
- `packages/shared/data/types/topic.ts` — `TopicContextManagementSchema` (Phase L)
- `packages/shared/data/types/agent.ts` — `Assistant.configuration.memory` (Phase M)

### NOT TOUCHED (in either V1 or V2)

- `src/main/ai/agent/Agent.ts` — context-chef integrates via plugin layer
- `src/main/ai/agent/loop/` — middleware sits below the loop
- Existing 11 `prompts/sections/` files — V1 hint sections are additive
- `branch-navigation` modules — separate concern (user-facing DAG nav)
- Cherry's existing `skills/`, `ToolRegistry`, `meta tools` — context-chef
  Skill / Pruner explicitly NOT used
- `agent_skill` / `agent_global_skill` tables — different concept from
  `agent_memory` (skill = behavior bundle, memory = data); zero overlap


## TODO — V3 deferred

These had concrete designs investigated but no current consumer pull;
or are mechanical polish; or are truly speculative. Track here so they
don't get lost; revisit when listed triggers fire.

### TODO-2 — `dynamicState` integration (4 remaining P1 consumers)
- **Status**: Candidate #1 (tool approval state) is being implemented
  in this branch as Phase N — it validates the dynamicState chain
  end-to-end. The other 4 candidates ship as follow-up PRs to keep PR
  scope reviewable. Could be done in this branch in principle (no
  organizational barrier), just a PR-size discipline call.
- **Decision rule** (recap): "If I evaluate this in iter 1 and re-read
  it in iter 5, is the iter-1 value still correct?" — Yes → Cherry
  section registry. No → dynamicState.
- **Remaining P1 candidates** (each ships when picked up):

  | # | State | Affected subsystem | Notes |
  |---|---|---|---|
  | 2 | **Subagent task progress** | `tools/agent/agentTool.ts` + `AsyncChildAbortMap` | Async subagent spawn returns immediately; parent sees nothing until result. Inject `{ activeAsyncTasks: [...] }` so parent can reason about whether to spawn retry. |
  | 3 | **Iteration counter / step budget** | `agent/loop/` | `stopWhen: stepCountIs(maxToolCalls)` is enforced silently; model has no `{ currentIteration, maxIterations, remaining }`. Inject so model can batch smartly near the limit. |
  | 4 | **Per-tool retry counter** | `agent/loop/internal.ts` (wrap retries) | Today `onError` hook is unimplemented; model retries blindly. Inject `{ toolRetries: { [name]: { attempts, lastError } } }` so model sees "I've failed 3x, change tactics". |
  | 5 | **Token budget remaining** | `agent/observers/usage.ts` | `usage.ts` accumulates but doesn't surface. Inject `{ usedTokens, remainingTokens, contextWindow }` so model can self-checkpoint. |

  CWD changes (P2) are excluded — model shouldn't rely on shell-internal
  cd anyway.
- **Multiple-state coexistence**: Once Phase N lands, `dynamicState.getState()`
  returns the approval state. When candidate #2/#3/#4/#5 lands, it
  must MERGE its keys into the same returned object, not overwrite —
  chef accepts ONE `dynamicState` config per middleware instance. Pattern:
  `getState: () => ({ ...approvalState, ...subagentState, ...iterationState })`.
  Suggest a small `dynamicStateRegistry` helper in Cherry to manage
  contributors, similar to section registry.
- **Trigger to revisit (each)**: When the affected subsystem owner
  picks it up. Subagent (#2) is next-warmest — currently parent agents
  spawning async subagents are flying blind.

### TODO-3 — `transformContext` escape hatch (consumed by Phase I)
- **Status**: Phase I (Assembler invocation) is the first real consumer
  of `transformContext`. This validates the pattern.
- **Why still TODO**: No need to build a generic abstraction layer
  around it for "any feature that wants to rewrite the prompt
  imperatively" — there's only one consumer. If a second consumer shows
  up, generalize then.
- **Trigger to revisit**: Second feature wants `transformContext`
  access.

### TODO-6 — agent-internal Snapshot/Restore
- **Status**: Verified — Cherry has **zero current consumers**.
  - User-facing branching: covered by `branch-navigation` (DAG message
    tree, fully separate concern).
  - Transactional file patches: `applyPatch.ts` already has
    within-call rollback; agent-loop-spanning rollback is a future
    speculative-repair scenario nobody is asking for.
  - Mid-loop error recovery: chef's per-call isolation + Cherry's DB
    persistence already handle today's failure modes without snapshot.
  - Steering / pending message queue: linear append-only; snapshot
    would only matter if user could "undo my injection mid-stream",
    which the UX doesn't support.
- **Trigger to revisit**: First request for speculative agent behavior
  — multi-approach exploration ("try N approaches, pick the best") or
  transactional cross-iteration tool execution.

### TODO-7 — `XmlGenerator` consistency refactor
- **What**: Swap hand-built XML in existing sections (`envSection`,
  `skillsCatalogSection`, others) to `@context-chef/core`'s
  `XmlGenerator.objectToXml()` for consistency with chef-emitted XML.
- **Why deferred**: Pure mechanical refactor, no functional change.
  Should land after V1 + V2 stabilize so it's a clean diff.
- **Trigger to revisit**: TODO-2 (dynamicState) lands and emits XML
  alongside section-registry XML — visual mismatch becomes obvious.

### TODO-10 — Offloader reconcile lifecycle hook
- **What**: Call `Offloader.reconcileAsync()` once at boot to adopt
  orphan `vfs_blob` rows back into the Offloader's in-memory index.
- **Why deferred**: Edge case (only matters if process crashed
  mid-write or app updated mid-write). Workaround: orphan rows are
  still readable on demand via `vfs_read` tool — they just don't
  participate in eviction until a future write triggers reconcile.
- **Trigger to revisit**: Integration test reveals leaked rows after
  forced kill, OR users report "View full" buttons that show empty
  content for old blobs.

### TODO-12 — MCP-only namespace dispatcher (selective Pruner-style)
- **What**: Apply chef Pruner Layer 1 (single virtual dispatcher tool)
  ONLY to MCP tools, keep built-in tools as named individual tools.
- **Motivation**: MCP servers are the most volatile source of toolset
  byte drift — users start/stop MCP servers freely, each carries
  20–200+ tools. Phase H caches these but every settings change still
  invalidates. Wrapping MCP tools in a single `mcp_invoke` dispatcher
  with `{ server: enum, tool: string, args: object }` parameters
  eliminates byte drift from this source entirely (definition shape
  never changes; only the `server` enum membership might).
- **Why deferred**: Requires a renderer / approval-layer rework — MCP
  tool calls today render with their actual name, approve by name,
  log by name. Going through `mcp_invoke` would need new visualization
  + a name-resolving approval layer. Substantial UX work for a
  middle-of-the-distribution improvement.
- **Built-ins stay named**: shell / fs / web / kb tools keep their
  named exposure — they have stable applies predicates (gated only by
  assistant settings), low count, and Cherry's renderers depend on
  per-tool components in `MessageAgentTools/cherry/`.
- **Trigger to revisit**: MCP tool count per assistant routinely
  exceeds ~30 OR Anthropic cache miss rate stays high after Phase H +
  Phase I land OR a power user with a 200+ tool MCP setup complains
  about cost.
- **Rough sketch**:
  ```ts
  {
    name: 'mcp_invoke',
    description: 'Invoke a tool from a connected MCP server',
    parameters: {
      server: z.enum([...installedServerNames]),
      tool: z.string(),
      args: z.record(z.unknown())
    }
  }
  ```

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-06 | Use middleware, not core directly | `createAgent` doesn't expose `LanguageModel`; middleware rides existing `context.middlewares` rail |
| 2026-05-06 | Per-request middleware (no topic cache) | Janitor state matters per-turn (multi-iteration), not cross-turn (history is already post-compression on disk) |
| 2026-05-06 | DB-backed VFS adapter, not filesystem | Reuses Cherry's SQLite, free cascade delete, single source of truth for renderer |
| 2026-05-06 | Skip core's Memory / Pruner / Snapshot / Skill | Each overlaps with a Cherry-owned subsystem (no memory product surface; ToolRegistry+meta tools cover Pruner; branch-navigation covers user branching; skills__load already wired) |
| 2026-05-06 | `compact` + `truncate` ON by default; `compress` OPT-IN | Compaction is zero-cost; truncate solves the immediate shell/fs output pain; compress costs $ and needs explicit model pick |
| 2026-05-06 | `dynamicState` deferred | Currently overlaps with section registry; will revisit when there's a concrete per-iteration state worth re-injecting (iteration counter, pending approvals) |
| 2026-05-06 | Settings live on Provider, not Topic | Mirrors anthropicCache's placement; per-topic override can be added later additively |
| 2026-05-06 | `buildSystemPrompt` adds 3 behavior-explainer sections, doesn't host chef capabilities | Middleware capabilities are message-layer rewrites; sections only document chef behavior to the model so it cooperates |
| 2026-05-06 | Two-layer prompt assembly model recognized | chef DOES insert system messages of its own (skill, dynamicState placement:'system') but always AFTER user system. Cherry section registry stays as the per-turn cacheable outer layer; chef's slots are reserved for per-iteration mutable state (TODO-2). Confirmed by reading `ai-sdk-middleware/src/middleware.ts` 8-step `transformParams` pipeline. |
| 2026-05-06 | TODO-5 promoted to Phase H (real KV-cache regression) | Source trace verified: Cherry's `selectActive(scope)` runs every request with `applies` predicates that vary on user-toggleable assistant state (`enableWebSearch`, `knowledgeBaseIds.length`, MCP server set). Mid-conversation toggles → tool definition bytes shift → Anthropic prefix cache misses on every subsequent turn. Fix: cache toolset per topic, invalidate on settings change. |
| 2026-05-06 | TODO-11 promoted to Phase I (Assembler not invoked in middleware) | Source trace verified: `fromAISDK`/`toAISDK` preserve content but don't sort keys. AI SDK + provider SDKs also don't normalize. Fix: invoke `Assembler.orderKeysDeterministically` via chef's `transformContext` callback. Also sort `params.tools` at toolset cache insert time (Phase H). |
| 2026-05-06 | TODO-9 promoted to Phase J (citation tool truncation gap is real) | Source trace verified: `WebSearchTool` and `KnowledgeSearchTool` return id-anchored arrays where the model cites `[id]`. Threshold-based truncation could cut mid-array → broken citations. Fix: `ToolEntry.truncatable: boolean` opt-out flag, Cherry registry feeds chef's exclude set, citation tools internally cap their own output. |
| 2026-05-06 | TODO-1 / TODO-8 promoted to Phase K / L (UX patterns reusable) | `ModelSelector` from `RagSettings.tsx` is the right primitive for compression model picker. No per-topic settings UI exists today; introduce one with "Inherit from provider / Override" radio per field. Compression default: opt-in only with no auto cheap-model — surprise-billing risk too high. |
| 2026-05-06 | TODO-4 promoted to Phase M (Memory module worth doing) | MemoryStore interface verified — 4 required methods + 2 optional. Memory injects content into system prompt automatically in middleware mode + auto-registers `create_memory` / `modify_memory` tools. Per-AGENT scope (Cherry has agents but not users). New `agent_memory` table; orthogonal to existing `agent_skill` (skill = behavior, memory = data). |
| 2026-05-06 | TODO-6 stays deferred (zero current consumers verified) | Source trace: branch-navigation covers user-facing forks; `applyPatch` already has within-call rollback; chef's per-call isolation + Cherry DB persistence cover error recovery; PendingMessageQueue is append-only by design. No code path in Cherry today benefits from full agent-state snapshot/restore. |
| 2026-05-06 | TODO-2 keeps 5 P1 candidates identified, but stays deferred | dynamicState's value is per-iteration injection. 5 concrete consumers found (approval / subagent / iteration counter / retry counter / token budget), each requires its own subsystem driver. Most likely first lander: tool-approval state (currently zero signal to model when approval just came through). |
| 2026-05-06 | Phase I (Assembler) downgraded from "real fix" to defensive insurance | Re-examination: JS `JSON.stringify` uses insertion order; Cherry's deterministic construction code likely produces stable bytes already. Phase I is insurance against subtle drift, not a known-broken fix. Defer until cache-hit metrics post-Phase-H actually show <80% hit rate. |
| 2026-05-06 | Phase J simplified: flag only, no enforced internal cap | Earlier "B+C combo" (tool author internally caps + flag opt-out) was over-prescription. Tools that mark `truncatable: false` are responsible for their own size; if a citation tool over-produces, that's the tool's bug to fix (paginate / drop low-relevance), not Cherry's orchestration concern. |
| 2026-05-06 | Phase J split into J.1 (upstream chef) + J.2 (Cherry wiring) | Right place to add "skip these tool names" is chef's `truncate` option itself — every consumer benefits. J.1 is being implemented in the chef repo in parallel; J.2 consumes it once released. Avoids `transformContext`-based workaround in Cherry. |
| 2026-05-06 | Phase H beats Pruner-style namespacing for Cherry | Considered making EVERY tool go through a single `tools` dispatcher (chef Pruner Layer 1). Trade-offs: overlaps Cherry's existing `tool_search`/`inspect`/`invoke` meta-tools, regresses model UX (multi-step dispatch), breaks per-tool renderers in `MessageAgentTools/cherry/`, requires approval-layer rewrite. Phase H gets ~95% of cache benefit with ~5% of the change. Pruner-style for MCP tools only stays as TODO-12. |
| 2026-05-06 | TODO-2 deferral reason restated: scope discipline, not org boundaries | Earlier "owner team" wording implied organizational barriers; correction: same codebase, same team, no barriers. Real reason for deferral is keeping the PR scope reviewable. |
| 2026-05-06 | Phase N added (tool approval state via dynamicState) | Cherry's #1 dynamicState use case: model has zero signal when approval just came through; today must infer from history. Solving in this branch validates the dynamicState chain end-to-end before TODO-2's 4 remaining candidates queue up as follow-up PRs. Adds in-memory ring buffer + new `dynamicState` config in contextChef feature. Risk low: failure mode degrades to current behavior. |
