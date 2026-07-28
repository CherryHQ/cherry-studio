# Tool-Approval Defer Bypass — Fix Design

> Addresses the PR review's highest-priority architecture point (#1): the
> tool-approval gate is bypassed when a deferred tool is called via the
> `tool_invoke` meta-tool. Companion to [tool-cluster.md](./tool-cluster.md) and
> [`docs/references/ai/tool-approval.md`](../../../docs/references/ai/tool-approval.md).

## Context

When **defer-exposition** is active (high tool-count → tools hidden behind meta-tools to
save context), a deferred MCP tool is removed from the AI SDK `ToolSet` and is only
reachable through the `tool_invoke` meta-tool. The AI SDK enforces `needsApproval` **only
when it dispatches a first-class tool it can see in the `ToolSet`** (`node_modules/ai` →
`run-tools-transformation.ts:292-324` looks up `tools[toolName]`; a deferred tool isn't
there). `tool_invoke.execute` then calls `entry.tool.execute(...)` **directly**
(`meta/toolInvoke.ts:33`), so the inner tool's `needsApproval` is never consulted.

Result: a tool the user marked **"always ask"** (MCP `disabledAutoApproveTools` →
`isMcpToolForcePromptBySource`) runs with **no approval card** — precisely in the
high-tool-count case defer targets.

Today the **only** `needsApproval` producer is MCP (`mcpTools.ts:26`,
`needsApproval: async () => isMcpToolForcePromptBySource(server, mcpTool)`), and it is
**input-independent** (a per-(server,tool) policy, not a function of call args).

## Approach: keep approval-gated tools inline (Option A) + a registry-boundary guard

Two changes close the bypass; both are required.

1. **Never defer an approval-gated tool.** Keep it in the SDK `ToolSet` so the SDK's
   native gate fires exactly as for any non-deferred tool (validated at SDK source:
   membership in the `ToolSet` is the entire contract — line 311 calls `isApprovalNeeded`
   with the real input and `break`s before execute).
2. **Guard the registry execution boundary.** `tool_invoke` (and the dormant `tool_exec`)
   must refuse to run an approval-gated tool, because `registry.getByName` returns **any**
   registered entry by name — a model can supply a gated tool's name even when it isn't
   listed by `tool_search`. This guard is **load-bearing**, not just defense-in-depth, and
   is authoritative for the (hypothetical) input-dependent-approval case since it runs at
   call time with the real input.

### Option B (rejected)

Build an aiSdk-side approval registry so `tool_invoke` itself emits
`tool-approval-request`, registers a pending promise, awaits the decision, then runs/denies.
Rejected: the aiSdk/MCP approval path is **stream-restart-based** (no awaitable promise;
only Claude Code has `ToolApprovalRegistry`), so B would duplicate the SDK's native gate
inside a synchronous execute — more trust-bearing code, worse shape. B's only upside
(deferring a force-prompt tool with a huge schema) is rare and better solved orthogonally.
Force-prompt tools are a deliberate minority (auto-approve is the default), so Option A's
only cost — they lose defer context-savings — is minor.

## Shared helper (single source of truth)

New: `src/main/ai/tools/adapters/aiSdk/isApprovalGated.ts`

```ts
isApprovalGated(tool: Tool, opts: { input?: unknown; toolCallId?: string;
  messages?: ModelMessage[]; experimental_context?: unknown }): Promise<boolean>
```

Mirror AI SDK `is-approval-needed.ts` semantics: `undefined` → false, `boolean` → value,
`function` → `await tool.needsApproval(input, { toolCallId, messages, experimental_context })`.
**Fail closed**: a throwing `needsApproval` returns `true` (keep-inline / refuse are both
the safe direction). Used by all three call sites below.

## Files to change

- **`mcp/mcpTools.ts` `toEntry`** — read `isMcpToolForcePromptBySource(server, mcpTool)` once
  and set `defer: forcePrompt ? 'never' : 'auto'` (the same value drives `needsApproval`, so the
  two always agree). `syncMcpToolsToRegistry` rebuilds entries every request, so the defer
  decision always reflects the current approval policy. This keeps the defer judgment at the
  tool's source, so `applyDeferExposition` stays pure defer-honoring logic — no approval
  knowledge, no `async`. MCP is the only `needsApproval` producer today; a future gated tool
  from another source must likewise carry `defer: 'never'`, with the execution-boundary guard
  below as the runtime backstop.
- **`meta/toolInvoke.ts`** — before the inner `execute`, `await isApprovalGated(entry.tool,
  { input: params ?? {}, toolCallId: options.toolCallId, messages: options.messages,
  experimental_context: options.experimental_context })`; if true, `throw` (matches the
  file's existing `Tool not found` error style) with a message telling the model to call
  the tool directly — it is now always inline.
- **`meta/exec/runtime.ts`** (`handleToolCall`, ~106-141) — same guard; on gated, emit the
  worker `toolError` ("requires approval; call it directly") instead of executing. Dormant
  today (`tool_exec` not injected), but structurally identical and cheap — prevents a
  latent reintroduction and closes the reviewer's separate `tool_exec` note in the same
  change.

`deferredEntries` is consumed only by `assembleSystemPrompt.ts:34-35`
(`<DEFERRED_TOOLS>` per-namespace counts) and `toolSearch.ts:42` (filters by
`deferredNames`). Both *want* gated tools excluded — no breakage; the single
`deferredNames` source keeps prompt + search consistent automatically.

## Tests

- **`mcp/__tests__/sync.test.ts`** — a force-prompt tool (in `disabledAutoApproveTools`) is
  registered with `defer: 'never'`; a non-gated sibling stays `defer: 'auto'`.
- **`meta/__tests__/toolInvoke.test.ts`** — invoking a gated tool via `tool_invoke` is
  refused and the inner `execute` is **not** called; existing non-gated forwarding tests
  pass unchanged.
- **`meta/__tests__/isApprovalGated.test.ts`** (new) — undefined→false, boolean honored,
  function honored, throw→true (fail closed).

## Docs to sync after the fix

- `docs/references/ai/tool-approval.md` + `tool-registry.md`: add the invariant —
  "Approval-gated tools are never deferred; they stay inline so the SDK's native
  `needsApproval` gate fires. `tool_invoke` / `tool_exec` refuse any approval-gated tool
  and instruct the model to call it inline."
- [tool-cluster.md](./tool-cluster.md): same invariant in the cluster guide.

## Verification

1. `pnpm test` for the three test files above (new + amended).
2. `pnpm lint` (oxlint + eslint + typecheck — confirms the `async` ripple compiles).
3. Manual/integration sanity: with an MCP server whose tool is in `disabledAutoApproveTools`
   and enough tools to trigger defer (`shouldDefer` gates: ≥5 auto tools, cost > 10% of
   context window), confirm the force-prompt tool is **inline** (not behind `tool_invoke`)
   and that calling it surfaces the approval card; confirm a non-gated peer is still
   deferred and runs via `tool_invoke` without a card.

## Follow-up (separate from this change)

Reply to the reviewer on #1 pointing at the two enforcement sites (`mcpTools` registers
force-prompt tools with `defer: 'never'` + the `tool_invoke`/`tool_exec` execution guard) with
`file:line`, and note `tool_exec`'s
"refuse, don't await" stance (ties to reviewer #3 — the `tool_exec` sandbox). Architecture
points #2 (dispatch TOCTOU + crash reconciliation) and #4
(`provider.defaultChatEndpoint` capability resolution) remain separate confirm-or-correct
items.
