# Tool-Approval Refactor — centralize `G`, retire per-tool `needsApproval`

> Status: design, not implemented. Grounds Phase 1 of [`migration-plan.md`](./migration-plan.md) (Lift `G`).
> Decision (`G`) and state (message parts) are **two separate things** — this doc is about the *decision*;
> the *state* is owned by the in-tree consolidation design ([`../tool-approval-state-consolidation.md`](../tool-approval-state-consolidation.md)).
> No OPA — `PermissionEngine` is hand-rolled by folding existing scattered logic.

## v6 / v7 reality (verified in `node_modules/ai`)

| | v6 (Cherry now) | v7 |
|---|---|---|
| message-based flow (`tool-approval-request`/`-response` parts, `addToolApprovalResponse`) | ✅ has | ✅ |
| `needsApproval` (per-tool, `boolean \| fn→boolean`, on the tool def) | ✅ has (deprecated in v7) | deprecated |
| **centralized `toolApproval` setting** (fn/map on the call/agent, 3-way `ToolApprovalStatus`) | ❌ **absent** | ✅ new |

So the **flow** is v6; the **centralized `toolApproval` config** is v7-only. (This corrects earlier docs that said
"toolApproval present in v6".)

## Current state (mapped by exploration)

**Two gating *mechanisms*, not aligned:**

| | trigger | mechanism | state authority |
|---|---|---|---|
| aiSdk (chat/agent) | `needsApproval: async()=>forcePrompt` on MCP tools (`src/main/ai/tools/adapters/aiSdk/mcp/mcpTools.ts:29`) | SDK-native → emits `tool-approval-request` part → **message-based** | ✅ DB message part (`ToolUIPart.state/approval`) |
| claudeCode | `canUseTool` callback (`src/main/ai/runtime/claudeCode/settingsBuilder.ts:608`) | **in-memory `ToolApprovalRegistry` pause-and-await** (promise blocks, lost on restart) | part is UI projection only; real authority = in-memory registry |

→ aiSdk is **already** the v7-style message-based model; claudeCode is the old in-memory blocking model.

**The decision (`G`) is scattered across three places, no single function:**
- claudeCode: `src/shared/ai/claudecode/toolRules.ts:75-126` — `resolveClaudeToolInvocationAccess` →
  `'auto' | 'prompt'` (permission_mode + `DEFAULT_SAFE_TOOLS` + `ACCEPT_EDITS_TOOLS` + bash sub-command match).
- aiSdk MCP: `src/shared/ai/tools/mcpSourcePolicy.ts:35-46` — server `disabledAutoApproveTools` allowlist → boolean,
  baked into each tool's `needsApproval`.
- builtin (web/kb): **no `needsApproval`** → implicit auto; aiSdk tools are **not permission_mode-aware** (a gap).

Gate-read sites that consult `needsApproval` today: `src/main/ai/tools/adapters/aiSdk/isApprovalGated.ts:27-41`
(used by the defer build `applyDeferExposition.ts` and the `toolInvoke.ts:73-82` guard).

`needsApproval`'s problems: per-tool, boolean-only (can't express deny-without-ask, no reason), scattered, and
MCP-source-only (no mode awareness). v7 deprecates it for exactly these reasons.

## The refactor (4 steps)

**Step 1 — one `PermissionEngine` (`G`).** New `src/main/ai/runtime/permission/PermissionEngine.ts`:
```ts
evaluate({ toolName, input, runtimeContext /* permission_mode, mcp source, ... */ })
  : { verdict: 'allow' | 'ask' | 'deny'; reason?: string }
```
Fold in all three sources: `resolveClaudeToolInvocationAccess` (toolRules) + `resolveMcpSourceToolAccess`
(mcpSourcePolicy) + builtin defaults (allow) + permission_mode. Driver- and tool-set-agnostic — aiSdk tools
become mode-aware (closes the current gap). Net code **down** (consolidates existing scattered logic).

**Step 2 — repoint the gate-read sites to the engine, stop reading `tool.needsApproval`.**
- `isApprovalGated.ts` → `engine.evaluate(...).verdict === 'ask'` (this also fixes the defer build + `toolInvoke` guard, which call it).
- claudeCode `canUseTool` → swap `snapshot.resolve` for `engine.evaluate` (same `G`).
- aiSdk MCP build (`mcpTools.ts:29`) → drop the bespoke `needsApproval: async()=>forcePrompt`.

**Step 3 — handle trigger + deny on v6 (no centralized `toolApproval` yet).**
The v6 message flow is still *triggered* by `needsApproval`, so don't delete it on v6 — demote it to a uniform
delegation shim injected when building the tool set:
```ts
needsApproval: (input, opts) => engine.evaluate({ toolName, input, ... }).verdict === 'ask'
```
- `ask` → `needsApproval` true → SDK emits the request part (existing message flow).
- `deny` (boolean can't express) → handle at the **availability** layer: claudeCode `canUseTool` returns
  `{behavior:'deny', reason}` (already supported); aiSdk drops the tool from the exposed set (the existing
  `disabledToolHook` path). **Don't fake deny via `needsApproval`.**
- `allow` → no gate.

**Step 4 — v7 cutover (after D1): delete `needsApproval` entirely.** Replace the per-tool shim with one
`toolApproval` function on the agent = the engine:
```ts
toolApproval: ({ toolCall, runtimeContext, messages }) => {
  const { verdict, reason } = engine.evaluate(...)
  return verdict === 'allow' ? 'not-applicable'
       : verdict === 'ask'   ? 'user-approval'
       : { type: 'denied', reason }   // 3-way maps 1:1 to ToolApprovalStatus
}
```
`needsApproval`, `isApprovalGated`, and the per-tool shim all disappear.

## Boundaries (what this does NOT touch)

- **State authority stays DB message parts** — this refactor changes *who decides*, not *where the decision is
  stored*. The `ToolUIPart.state/approval` single-authority model ([`../tool-approval-state-consolidation.md`](../tool-approval-state-consolidation.md))
  continues unchanged.
- **Mechanism unification (claudeCode in-memory registry → message-based)** is **not** here. It happens when the
  aiSdk driver replaces claudeCode in [`migration-plan.md`](./migration-plan.md) Phase 2 / Phase 5; until then the
  registry stays but consumes the same `engine` decision.

## Bonus insight: the v7 approval refactor *is* D6/D7

The native message-based flow (call **completes** with a `tool-approval-request` part in history → decision pushed
back as a `tool-approval-response` part → re-invoke to resume) is exactly the "approval = serializable suspended
state" that D6/D7 proposed borrowing from HarnessAgent — and it's native, in-history, durable. So Phase 5 should
**lean on this native flow** rather than build a custom suspend/continue store, and it resolves the approval
split-brain the consolidation doc wrestles with (single authority = the message part).
