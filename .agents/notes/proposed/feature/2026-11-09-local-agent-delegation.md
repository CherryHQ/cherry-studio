# Agent Note: Unify local CLI delegation with Agent Services

Status: proposed

English | [中文](2026-11-09-local-agent-delegation.zh.md)

## Problem

[PR #21221](https://github.com/CherryHQ/cherry-studio/pull/21221) adds persistent local Agent conversations, but three Code Mate skills still launch independent headless CLI commands. The skills select executables from the shell, refer to the retired Code Mate configuration UI, and are automatically installed when a binary is available regardless of the local Agent's enable switch. Removing them before an equivalent delegation path exists would lose project-scoped task execution.

Source inspection at PR head `909ce14a6882b9ff6fe98ecfa12cc6b635bf3e7d` establishes the following boundaries. This is code evidence, not a completed real-CLI acceptance run.

| Existing mechanism | Reusable capability | Missing contract |
| --- | --- | --- |
| `cherryAutonomyTools.ts`: `agent_list`, `session_create`, `session_send` | Immutable Agent/session identities; live caller approval; asynchronous completion requests | Discovery does not filter disabled local Agents; creation has no explicit project override |
| `AgentSessionDeliveryService` and message persistence | FIFO admission, durable request/result correlation, terminal reporting, recovery | Delivery runs headlessly; it does not own delegated-task controls or parent approval routing |
| Local runtime from #21221 | Configured executable, model, credentials, streaming tools, protocol approvals and cancellation | No complete host-owned delegation relationship is exposed to the originating conversation |
| `SkillService.uninstallBuiltinSkill` | Namespace/source ownership checks protect user skills | CodeCliService still automatically reinstalls the three legacy skills |

The existing [cross-Agent workspace decision](../../implemented/bug-fix/2026-10-20-cross-agent-session-workspace.md) deliberately preserves the target Agent's last workspace. It remains correct for ordinary session creation. A coding task for an explicitly selected project needs a distinct, explicit workspace binding rather than silently changing this default.

The [subagent control design](../architecture/2026-10-18-agent-runtime-subagent-control.md) assigns host-created cross-runtime work to host orchestration. Native child relationships and ordinary cross-session messages must not be reclassified as host-owned delegations.

## Proposal

### Public behavior and scope

Use Agent Services as the single configuration owner. Direct chat and delegated work resolve the same enabled Agent, configured executable, native model and environment. Listing a driver must not imply that its binary, credentials or model are ready. Discovery exposes only enabled local targets and reports configuration/readiness honestly; admission rechecks enablement and driver validation before starting work.

Add one explicit `agent_delegate` entry to the existing Cherry tool surface. It accepts an immutable target Agent ID, task text and an explicit existing workspace ID or caller-workspace choice. It creates a dedicated target conversation, returns a durable request ID and session ID immediately, and delivers one terminal result asynchronously. The default is the caller's workspace; when there is no user project, use a fresh managed workspace. Reject missing/deleted project selections instead of falling back to the target's last project. The delegation approval identifies target and project before execution.

Ordinary `session_create` and `session_send` retain their documented directory and headless behavior. Delegation is opt-in and bounded to one hop. Initial callers are Cherry runtimes that already expose Cherry tools; local Agents are targets, not automatically new callers. Do not inject Cherry tools into native CLI configuration or promise that every ACP Agent can delegate onward.

### Ownership, approvals and progress

A lifecycle-managed host delegation owner orchestrates creation, cancellation, parent presentation and recovery. Reuse runtime dispatch, native connections, message persistence and existing result correlation. Keep `AgentSessionDeliveryService` responsible for delivery rather than making it the owner of native subagents. Reuse the persisted delivery request ID, sender/source-message identity, receiver session and turn reference. Add only the typed delegation discriminator and control metadata that existing records cannot express; do not introduce a parallel task table or execution engine. Any required SQL schema change uses an appended migration and populated-database tests.

The originating conversation shows target, project, progress and a link to the target conversation. Reuse existing message/tool rendering and approval controls. Route each target approval and supported structured question through its real target session and approval ID, with visible originating-task context. Approval of delegation is not approval of target tools. Parent-turn completion must not lose pending target approvals. A genuinely unavailable responder uses the existing deny/unavailable path; never force auto mode or bypass permissions.

### Stop, cancellation and recovery

Add `delegation_cancel(requestId)` and a matching task-card action. The host checks ownership; cancellation of request A can never interrupt a later request B. Cancel queued work without starting the CLI; cancel running work through its target runtime, then report the observed terminal state. Repeated cancellation and completion/cancel races produce one final result. CLI failure and timeout are failures, not successful empty replies.

Stopping the parent reply does not cancel delegated work. Cancellation is an explicit task-card action or delegation_cancel call. Switching away from the view does not cancel the task. Completion remains available through the existing asynchronous result delivery. Deleting the origin cancels owned work and releases pending approvals. Disabling a target prevents new delegation admissions and cancels pending/running delegated work for it; existing history remains readable.

After restart, reconcile durable records against actual target execution. Resume only where the runtime can prove continuity; otherwise mark interrupted, preserve partial output and do not replay the task. Existing result correlation prevents duplicate terminal delivery. Native harness-owned subagent lifetimes are unaffected.

### Retire legacy skills after parity

After the acceptance criteria below pass, stop automatic skill installation in CodeCliService and remove the bundled `code-mate-claude-code`, `code-mate-codex` and `code-mate-opencode` resources and their skill-only preset fields. Retain CLI installation, authentication and terminal launch behavior.

Reconcile installed system-owned copies using the existing source/namespace ownership guard. User-created, imported or differently owned same-name skills and their files remain untouched. Repeated startup and install/update actions must not recreate retired builtins. Update the existing tool guide to teach Agent discovery and unified delegation; do not replace three shell skills with three new wrappers. Keep the old skills until replacement acceptance passes, rather than shipping an intermediate loss of capability.

### Delivery sequence

1. The user approved implementation in the development conversation and explicitly waived waiting for GitHub Approval. Stack the Spec on #21221 and preserve the current user test instance.
2. Core PR: implement discovery, the explicit delegation entry and project binding, reusing durable result delivery; verify AC1, AC2 and affected AC8 regressions.
3. Interaction PR: implement parent progress/approval presentation and precise cancellation/recovery; verify AC3–AC5 and run bounded real Codex, Claude Code and OpenCode scenarios for AC7 in an isolated profile/project.
4. Migration PR: retire only owned legacy skills after parity, update the tool guide and complete AC6/AC8 evidence before moving the Spec to implemented.

## Alternatives considered

- Rename the skills and update their settings links: smaller, but preserves two execution paths and inconsistent enablement/configuration.
- Delete the skills immediately and use `session_create` unchanged: loses explicit project selection, originating-session approval routing and task-specific cancellation.
- Change every cross-session message into interactive delegation: breaks existing headless messaging and its ownership boundaries.
- Use native subagent tools for all targets: native creation/control is not a portable cross-runtime contract, and local runtimes do not all expose Cherry tools.

## Acceptance criteria

- AC1 — Disabled local Agents are absent from delegation discovery; disabling between discovery and admission cannot launch them; enabled targets reuse Agent Services configuration without inventing a Cherry model requirement. (verification: unit — discovery and local-runtime owners)
- AC2 — Delegation operates only in the explicitly selected or caller workspace, rejects stale workspace IDs, and leaves ordinary cross-Agent session defaults unchanged. (verification: unit — real database routing tests)
- AC3 — Parent UI shows correlated progress and target approvals/questions; target IDs are preserved, parent-turn completion does not lose interaction, and unavailable responses never grant permission. (verification: renderer and Electron — runtime/UI owners)
- AC4 — Queued/running/repeated cancellation, parent deletion, target disablement and completion races settle the correct request once without stopping unrelated later work; stopping only the parent reply leaves delegated work running. (verification: unit and Electron — delegation owner)
- AC5 — Crash/restart, CLI failure and timeout preserve partial history, report truthful outcomes, do not blindly replay work and do not duplicate result delivery. (verification: unit — populated database and runtime fixtures)
- AC6 — Owned legacy skills disappear only after replacement parity; same-name user skills remain intact; restart/install/update cannot reinstall retired builtins; CLI install/auth/terminal flows still work. (verification: unit and Electron — skill and CodeCli owners)
- AC7 — Real Codex, Claude Code and OpenCode each complete a bounded delegated task with correct project/model configuration and result return; supported approval/cancel paths are exercised and version-specific limits are recorded without claiming universal compatibility. (verification: Electron — integration owner)
- AC8 — Existing session delivery and native-subagent contracts pass focused regressions; the tool guide and bilingual design describe the supported caller/target boundary and recovery behavior. (verification: unit and docs gate — integration owner)

## Verification progress

On 2026-11-10, real delegated tasks completed and returned results through Codex, Claude Code 2.1.260 (Cherry Gateway / DeepSeek V4.1 Flash), and OpenCode (native `opencode/deepseek-v4.1-flash-free`). Claude Code's AskUserQuestion appeared in the parent card; selecting red returned red. An OpenCode `sleep 180` task was cancelled from the parent card before completion and returned a cancellation result. The earlier `sleep 45` completed normally and is not cancellation evidence.

The failed OpenCode Gateway run logged a malformed `provider.cherry-gateway` configuration. Cherry wrote `limit.context` from model metadata without `limit.output`; OpenCode requires both and skips the provider otherwise. The config builder now emits limits only when both values are valid, retaining CLI defaults when metadata is incomplete. Re-selecting the model regenerates previously written configuration; the repair does not rewrite user CLI files automatically or bypass ACP model validation.

Failed child turns now return their persisted error message in both the completion text and delivery metadata, retaining partial output and excluding error stacks. Explicit delegation timeout/cancellation errors take precedence. Regression coverage includes incomplete direct/Gateway model configuration, failed turns with and without partial text, and single terminal delivery: 75 renderer tests and 150 main tests passed. A subsequent isolated-profile live run verified OpenCode Gateway completion, specific model-error return, explicit cancellation, disabling a running target, parent-routed permission approval, and graceful restart without replay; each of six requests produced one terminal receipt. Rejecting an OpenCode tool permission stopped execution but returned only “Session failed without a text response.”, leaving the rejection reason unclear. Abrupt crashes, timeout, parent deletion, project overrides and user-owned skill preservation remain outside this live run. This note stays proposed and does not claim universal model compatibility.

The extended local-Agent checks exposed configuration-file/ACP model-ID mismatches in Qwen, MiniMax and Hermes. The connection now resolves only known provider-configured IDs against the advertised catalog, retaining strict rejection for unavailable models. Fresh real delegations through the normal provider configuration flow returned `FIX_QWEN_OK`, `FIX_MINIMAX_OK` and `FIX_HERMES_OK`, each with one persisted completion. Qwen and MiniMax uninstall successfully after replacing invalid optional-service lookups. Cursor discovery no longer treats Grok's `agent` symlink as Cursor. Required Bun discovery now considers compatible executables later on PATH; OMP 18.18.8 completes ACP handshake after an official-source install, while the configured npm mirror lacks one dependency. Factory Droid 1.7.1 also handshakes from an isolated official-source install. Neither handshake proves model authentication or a completed prompt. Antigravity identity checks now include stderr help output; a real uninstall removed both its CLI and ACP adapter successfully. Pi startup-text pollution remains an upstream adapter issue; Trae and source-installed Hermes removal remain unsupported. Hermes's shared gateway intentionally exits after its upstream idle timeout rather than immediately with the ACP viewer.

## Risks

The target CLI controls model access and protocol features; installation alone cannot prove readiness. Existing local-runtime readiness checks and error diagnostics remain authoritative. Parent-routed approvals require explicit responder ownership rather than merely clearing a headless flag. Cancellation must bind to a run, not only a session, and startup recovery must not repeat file edits. Workspace selection expands a tool schema and must preserve existing ordinary session semantics. Legacy-skill removal remains gated by real replacement evidence; a failing or unavailable CLI acceptance scenario blocks claiming full retirement readiness.
