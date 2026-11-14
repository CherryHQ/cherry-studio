# Agent Note: Preserve root approvals and identify subagent requests

Status: implemented

English | [中文](2026-11-12-agent-shell-approval-boundary.zh.md)

## Problem

Pi and Pi Durable children received `bypassPermissions` instead of the root session's permission mode. A model endpoint could delegate a tool call to bypass an approval required at the root. Child calls without a tool part in the root reply also lacked the input needed to render an approval card.

A provider-executed dynamic tool part could remain `input-available` while carrying `approval.id`; the composer's scan required `approval-requested`, leaving the turn waiting without approval controls. This presentation gap also affects approvals emitted by tools called from code mode.

The original endpoint report reproduced ordinary Bash execution without a prompt on packaged 2.1.10, writing `id` output to a file. This PR repairs child permission inheritance and approval presentation; ordinary auto Bash remains automatic. Command risk rules and parsing are separate work in [Spec #24419](https://github.com/CherryHQ/cherry-studio/pull/24419).

## Decision

Root and child threads read the same live permission mode, interaction state and tool restrictions. Delegation never grants Full Access. When a child call has no part in the root reply, the approval stream includes its input and spawning tool-call identity. Root message projection preserves that identity so the composer can identify the requesting task.

`codemode` retains its existing meta classification and automatic dispatch. It executes JavaScript in QuickJS without direct Node, filesystem or network access; nested tool calls still pass the standard approval gate. A child script calling Bash therefore requests approval for that Bash call whenever the root policy requires it. No extra mandatory code-mode confirmation is added. Ordinary auto shell calls retain the existing destructive-command detector; this PR adds no first-use Shell consent, session-wide Shell grant, or expanded command patterns.

The composer treats an unresolved approval on a not-yet-resolved part as pending. The approval card shows the requesting Agent or child task, background status and task navigation when available, plus a complete scrollable and copyable command preview. The optional rejection reason expands on demand. Enter on navigation or expansion controls does not approve the call.

## Alternatives considered

- Mandatory per-call code-mode confirmation: duplicates approval of the actual nested operation. QuickJS execution is already isolated from direct host access; the gate must protect nested tool effects, including in children, rather than add a second confirmation for the script.
- First-use Shell consent and connection-wide grants: considered in the original endpoint repair, then separated from this PR at the maintainer's request. Such consent can interrupt ordinary unattended execution, but does not constrain a program after approval. The separate command-policy Spec owns the selected auto behavior.
- Expanding the destructive pattern list alone: cannot repair child permission bypass or a missing approval surface, and still leaves the original `id > file` example unprompted in auto. Detector expansion belongs with the parser and command policy.
- Not advertising `bash`/`codemode` to custom endpoints: removes capabilities without a consent path and still requires inbound validation to establish an execution boundary.
- An OS sandbox (Seatbelt/bwrap) and a trusted-side classifier: deferred as a larger boundary change. Classification served by the same endpoint cannot establish independent trust.

## Consequences

- Children request approval whenever the root's current policy requires it. Without a responder, approval-bound calls block; foreground/background status does not bypass the gate.
- Code-mode dispatch adds no separate prompt. Nested file, shell and MCP calls retain their own tool restrictions and approval requirements, including responder-loss handling.
- Auto keeps ordinary shell execution automatic. Destructive commands still ask according to the existing detector. No per-session Shell consent is stored.
- This is an approval-routing repair, not an OS execution boundary. Unmatched auto commands can still perform destructive or external actions through aliases, scripts or arbitrary programs. The original ordinary-Bash endpoint report is not fully addressed by this narrowed PR.

## Verification

- Regression — `src/main/ai/runtime/pi/piApprovalFacts.test.ts`: ordinary auto Bash, in-root writes and code-mode dispatch retain their existing automatic behavior.
- Regression — `src/main/ai/runtime/pi/PiRuntimeConnection.test.ts`: each destructive root auto call waits independently; foreground/background children in default and auto honor approval, denial and responder loss before direct or code-mode-nested Bash file effects. The sole approval names the actual Bash operation and retains its spawning task identity.
- Regression — `src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.test.ts`: child writes require approval under the root's default mode.
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.test.ts` and `RootMessageProjection.test.ts`: child approvals retain input and origin metadata without duplicating an already-buffered input.
- Regression — `src/renderer/components/composer/variants/__tests__/permissionRequestComposerRequest.test.ts` and `PermissionRequestComposer.test.tsx`: dynamic approvals remain visible, resolved calls do not re-prompt, origin and command are shown, and Enter on disclosure controls does not approve.
