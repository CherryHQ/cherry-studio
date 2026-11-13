# Agent Note: Preserve root approval policy in subagents and code mode

Status: implemented

English | [中文](2026-11-12-agent-shell-approval-boundary.zh.md)

## Problem

Pi and Pi Durable children received `bypassPermissions` instead of the root session's permission mode. A model endpoint could delegate a tool call to bypass an approval required at the root. Child calls without a tool part in the root reply also lacked the input needed to render an approval card.

`codemode` executes code through `new Function` in a worker but carried `permissionClass: 'meta'`. The gate short-circuits meta calls, so code mode ran unprompted under `default` and `auto`. After dispatching approval, a provider-executed dynamic tool part could remain `input-available` while carrying `approval.id`; the composer's scan required `approval-requested`, leaving the turn waiting without approval controls.

The original endpoint report reproduced ordinary Bash execution without a prompt on packaged 2.1.10, writing `id` output to a file. This PR repairs child permission inheritance and code-mode approval; ordinary auto Bash remains automatic. Command risk rules and parsing are separate work in [Spec #24419](https://github.com/CherryHQ/cherry-studio/pull/24419).

## Decision

Root and child threads read the same live permission mode, interaction state and tool restrictions. Delegation never grants Full Access. When a child call has no part in the root reply, the approval stream includes its input and spawning tool-call identity. Root message projection preserves that identity so the composer can identify the requesting task.

`ToolCategory` includes `shell`, and the gate uses that category for the existing destructive-shell check. `codemode` is shell-class and explicitly requires approval under `default` and `auto`, including child calls. Root Full Access remains an exception. Ordinary auto shell calls retain the existing destructive-command detector; this PR adds no first-use Shell consent, session-wide Shell grant, or expanded command patterns.

The composer treats an unresolved approval on a not-yet-resolved part as pending. The approval card shows the requesting Agent or child task, background status and task navigation when available, plus a complete scrollable and copyable command preview. The optional rejection reason expands on demand. Enter on navigation or expansion controls does not approve the call.

## Alternatives considered

- First-use Shell consent and connection-wide grants: considered in the original endpoint repair, then separated from this PR at the maintainer's request. Such consent can interrupt ordinary unattended execution, but does not constrain a program after approval. The separate command-policy Spec owns the selected auto behavior.
- Expanding the destructive pattern list alone: cannot repair child permission bypass or a missing approval surface, and still leaves the original `id > file` example unprompted in auto. Detector expansion belongs with the parser and command policy.
- Not advertising `bash`/`codemode` to custom endpoints: removes capabilities without a consent path and still requires inbound validation to establish an execution boundary.
- An OS sandbox (Seatbelt/bwrap) and a trusted-side classifier: deferred as a larger boundary change. Classification served by the same endpoint cannot establish independent trust.

## Consequences

- Children request approval whenever the root's current policy requires it. Without a responder, approval-bound calls block; foreground/background status does not bypass the gate.
- `codemode` asks under `default` and `auto`; explicit root `bypassPermissions` allows it unless marked non-bypassable.
- Auto keeps ordinary shell execution automatic. Destructive commands still ask according to the existing detector. No per-session Shell consent is stored.
- This is an approval-routing repair, not an OS execution boundary. Unmatched auto commands can still perform destructive or external actions through aliases, scripts or arbitrary programs. The original ordinary-Bash endpoint report is not fully addressed by this narrowed PR.

## Verification

- Regression — `packages/agent-behavior/tests/core/approval/approval.test.ts`: shell classification preserves existing auto behavior; code mode asks under default/auto, blocks without a responder and retains the explicit Full Access exception.
- Regression — `src/main/ai/runtime/pi/piApprovalFacts.test.ts`: ordinary auto Bash and in-root writes run without approval; code mode emits an actionable request rather than taking the meta shortcut.
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`: each destructive root auto call waits independently; foreground/background children in default and auto honor approval, denial and responder loss before native Bash/code-mode file effects.
- Regression — `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`: child writes require approval under the root's default mode.
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts` and `RootMessageProjection.test.ts`: child approvals retain input and origin metadata without duplicating an already-buffered input.
- Regression — `src/renderer/components/composer/variants/__tests__/permissionRequestComposerRequest.test.ts` and `PermissionRequestComposer.test.tsx`: dynamic approvals remain visible, resolved calls do not re-prompt, origin and command are shown, and Enter on disclosure controls does not approve.
