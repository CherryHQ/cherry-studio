---
description: Tool approval migration constraints for AI SDK 7.0.127 and pinned main fixes, with the historical permission proposal
sources:
  - src/main/ai
  - package.json
---

# Tool Approval — Migration Constraints & Proposal

> Refreshed 2026-10-04 against Cherry `e3052500309` and the [release/main ledger](./aisdk-v7-feature-inventory.md#release-and-main-delta-ledger).
> The original permission-engine design follows as historical rationale.
> This update does not approve a new permission subsystem or change persisted approval ownership.

## Current SDK boundaries

| Surface | v6 | v7.0.127 |
|---|---|---|
| Approval request/response message flow | Available | Available |
| Per-tool `needsApproval` | Existing trigger | Deprecated compatibility surface |
| Central `toolApproval` | Absent | Call/Agent policy function or tool map |
| Approval request reason | Audit current projection | Distinct request reason and approver response reason |
| Signed approval continuation | Do not assume from old snippets | Verify secret configuration, serialization, input/schema validation, and persistent state |
| Code Mode nested approval | Cherry Pi has its own nested approval path | Code Mode package exposes callback/interrupt continuation APIs; explicit Cherry integration and black-box validation required |

Keep approval-required tools directly callable during the initial Core Code Mode adoption. The published
package exposes nested approval helpers despite the live guide's narrower claim; see the
[verified package contract and migration gate](./tool-discovery-plan.md#31-resolve-the-approval-contract-from-the-published-package).
Pi now uses native Code Mode and its nested `tool_call` gate; preserve that contract through any Harness
cutover rather than assuming the old worker still owns it. A policy verdict or signed SDK
approval does not replace Cherry's own authorization and state ownership. Validate approval-resumed
inputs against the actual schemas, including transforms, rather than treating persisted input as trusted.

SDK request reasons and the signed-approval / schema-transform fixes are relevant upgrade work; they do
not establish that the original `PermissionEngine` design is the right owner for every current runtime.
Compare with the [current approval reference](../tool-approval.md) and
[agent-session runtime](../agent-session-runtime.md) first.

## Verification before removing existing logic

- Exercise allow, deny, ask, and restart/resume with the current UI and persistence boundary.
- Verify denial completes correctly, request reasons survive projection, and modified tool schemas do not
  silently execute stale approved inputs.
- Test deferred tools under the same authorization rules as directly exposed tools.
- Confirm Code Mode cannot route around a required approval. Test nested callback/interrupt paths,
  stale/duplicate decisions, changed policy/schema, signing-key lifetime, and replayed side effects
  before exposing gated tools through the new engine.
- Keep provider-side execution and adapter-native approvals distinct from host-executed AI SDK tools.
- Include stale approval cleanup after `addToolOutput` (`7.0.126`) and equal approved inputs from another
  JavaScript realm (`7.0.127`). Reject changed input even when a previous input was authorized.
- Test same-message resume and new-message boundaries separately. Approval-state preservation on resume
  is main-only at `15f1a4d0531a`, not guaranteed by `7.0.127`; record the selected release or patch evidence.
- If adopting Harness ACP, verify `1.0.77` host-tool relay matching through the real adapter: approved
  tool and input must match, and stale/reused authorization must not execute an effect.

Sources: [Code Mode guide (see package correction above)](https://ai-sdk.dev/docs/ai-sdk-core/code-mode),
[published core changes](https://github.com/vercel/ai/blob/ai%407.0.127/packages/ai/CHANGELOG.md),
[Agent settings](https://github.com/vercel/ai/blob/ai%407.0.123/packages/ai/src/agent/tool-loop-agent-settings.ts).

<details>
<summary>June 2026 proposal — historical rationale, not a current implementation checklist</summary>

The following text preserves the original proposal, including its then-current paths, measurements,
and decision statuses. The dated assessment above supersedes its version and adoption conclusions.

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
  stored*. The `ToolUIPart.state/approval` single-authority model ([`../tool-approval-state-consolidation.md`](https://github.com/CherryHQ/cherry-studio/blob/13252a526ce01e9406c90b3492f1150706374eb5/v2-refactor-temp/docs/ai/tool-approval-state-consolidation.md))
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

</details>
