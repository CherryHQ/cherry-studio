# Agent Note: Ask before an unattended shell or code-mode call

Status: implemented

English | [中文](2026-11-12-agent-shell-approval-boundary.zh.md)

## Problem

An agent session treats the configured OpenAI-compatible endpoint's response as a trusted instruction source. Under `auto`, the only gate on a `bash` call was a pattern list of destructive commands, so an endpoint could return `tool_calls: bash` and have an arbitrary command run on the host with no prompt. `codemode` — code execution through `new Function` in a worker — carried `permissionClass: 'meta'`, and the gate short-circuits every meta call to allow, so it ran unprompted in every permission mode, `default` included.

Reproduced on a packaged 2.1.10 build: the endpoint received nine tool definitions including `bash` and `codemode`, and a `bash` call ran with no approval surface, writing `id` output to a file on the host.

## Decision

Treat code execution as a capability that never runs unattended, without changing what `auto` is for.

Both changes sit in the shared approval gate:

- The gate's shell branch selects on `category` instead of the tool-name strings `bash`/`powershell`, and `ToolCategory` gains `shell`, so a shell-class tool no longer depends on a name match.
- Under `auto`, a shell call asks until a person grants that tool once in the session. A destructive command still asks every time; the grant never covers it. The grant lives in `createPiInteractionPorts`, which both Pi and Pi Durable use.
- `codemode` is `shell`-class and on an always-ask set in the host facts, so code execution asks in every interactive mode. Its prompt is composer-owned: the pending-approval scan used to require `state === 'approval-requested'`, but a provider-executed dynamic tool part keeps `input-available` while already carrying `approval.id`, so the turn hung with no prompt. The scan now also treats an unresolved approval on a not-yet-resolved part as pending.

Deliberate limit: this is a boundary of consent, not of execution. It does not sandbox the command, and it does not make the destructive pattern list authoritative.

## Alternatives considered

- Inverting the shell rule into an allowlist of read-only commands: rejected. `auto` exists to remove routine prompts, and an allowlist would prompt on `ls`, `cat` and `grep`.
- Not advertising `bash`/`codemode` to custom endpoints: rejected as too abrupt — the capability disappears with no path back, and the runtime still needs inbound validation to make that a real boundary.
- An OS sandbox (Seatbelt/bwrap) and a trusted-side classifier: deferred. A classifier served by the same endpoint is worthless, and the sandbox is a larger change.
- Expanding the destructive pattern list alone: rejected as the primary repair, because it leaves the reported proof of concept (`id > file`) running unprompted.

## Consequences

- `auto` keeps its low friction for reads, edits inside the allowed roots, and non-destructive shell commands after the first grant.
- An unattended turn that needs a shell or `codemode` call now blocks instead of running it. Scheduled agents that relied on unattended shell calls will fail; a session-level exception is a later product decision.
- `codemode` asks under `default` and `auto`, and stays allowed under `bypassPermissions` unless it is also marked non-bypassable.
- Residual risk is unchanged and large: an endpoint can still get any command the person approves, and a granted session keeps running commands until it ends. The permission-mode descriptions still present `auto` as risk-aware; tightening that copy is a separate change.
- The grant is per connection, so resuming a session asks once more.

## Verification

- Regression — `packages/agent-behavior/tests/core/approval/approval.test.ts`: the shell category drives the `auto` decision, the first ungranted shell call asks, a granted session allows, a destructive command asks regardless of the grant, and `codemode` asks in every interactive mode and blocks when nobody can answer.
- Regression — `src/main/ai/runtime/pi/piApprovalFacts.test.ts`: the first `auto` shell call emits an approval request and the answer unblocks it, an in-workspace write still runs unprompted, and `codemode` asks instead of running as an exempt meta tool.
- Regression — `src/renderer/components/composer/variants/__tests__/permissionRequestComposerRequest.test.ts`: an unresolved approval on a dynamic tool part is pending, a resolved one is not, and an explicitly waiting part still resolves.
- Regression — `pnpm typecheck`: every project compiles with the new required `sessionGranted` fact.
- Manual — packaged Cherry Studio 2.1.10: before this change a local mock endpoint's `bash` call executed with no prompt; the reproduction is what this note repairs.
- Manual — dev build after the change: the same endpoint's first `bash` call rendered an approval card, wrote no proof file, and executed only after the approval.
- Manual — dev build, `codemode`: the gate dispatched the call and the turn then hung with no approval controls, which is what the composer-scan fix addresses; a live re-check after that fix is still outstanding.
