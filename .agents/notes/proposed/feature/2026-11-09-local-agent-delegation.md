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

A lifecycle-managed host delegation owner orchestrates creation, cancellation, parent presentation and recovery. Reuse runtime dispatch, native connections, message persistence and existing result correlation. Keep `AgentSessionDeliveryService` responsible for delivery rather than making it the owner of native subagents. Persist a typed delegation record keyed by request ID, including origin session/message, target session/run identity, workspace binding and terminal/cancel state. Any new SQL schema is introduced through an appended migration and populated-database tests.

The originating conversation shows target, project, progress and a link to the target conversation. Reuse existing message/tool rendering and approval controls. Route each target approval and supported structured question through its real target session and approval ID, with visible originating-task context. Approval of delegation is not approval of target tools. Parent-turn completion must not lose pending target approvals. A genuinely unavailable responder uses the existing deny/unavailable path; never force auto mode or bypass permissions.

### Stop, cancellation and recovery

Add `delegation_cancel(requestId)` and a matching task-card action. The host checks ownership; cancellation of request A can never interrupt a later request B. Cancel queued work without starting the CLI; cancel running work through its target runtime, then report the observed terminal state. Repeated cancellation and completion/cancel races produce one final result. CLI failure and timeout are failures, not successful empty replies.

Stopping the originating conversation cancels its outstanding owned delegations and suppresses automatic model wake after that stop; terminal results remain inspectable. Switching away from the view does not cancel the task. Deleting the origin cancels owned work and releases pending approvals. Disabling a target prevents new delegation admissions and cancels pending/running delegated work for it; existing history remains readable.

After restart, reconcile durable records against actual target execution. Resume only where the runtime can prove continuity; otherwise mark interrupted, preserve partial output and do not replay the task. Existing result correlation prevents duplicate terminal delivery. Native harness-owned subagent lifetimes are unaffected.

### Retire legacy skills after parity

After the acceptance criteria below pass, stop automatic skill installation in CodeCliService and remove the bundled `code-mate-claude-code`, `code-mate-codex` and `code-mate-opencode` resources and their skill-only preset fields. Retain CLI installation, authentication and terminal launch behavior.

Reconcile installed system-owned copies using the existing source/namespace ownership guard. User-created, imported or differently owned same-name skills and their files remain untouched. Repeated startup and install/update actions must not recreate retired builtins. Update the existing tool guide to teach Agent discovery and unified delegation; do not replace three shell skills with three new wrappers. Keep the old skills until replacement acceptance passes, rather than shipping an intermediate loss of capability.

### Delivery sequence

1. Obtain exact-head approval of this Spec; keep #21221 and its current user test instance intact.
2. Integrate after #21221 is available on the implementation base; implement discovery, delegation ownership and project binding with focused database/runtime tests.
3. Implement parent progress/approval presentation and precise cancellation/recovery, then run bounded real Codex, Claude Code and OpenCode scenarios in an isolated profile/project.
4. Retire only owned legacy skills after parity, update docs, and publish implementation layers linked to these acceptance criteria.

## Alternatives considered

- Rename the skills and update their settings links: smaller, but preserves two execution paths and inconsistent enablement/configuration.
- Delete the skills immediately and use `session_create` unchanged: loses explicit project selection, originating-session approval routing and task-specific cancellation.
- Change every cross-session message into interactive delegation: breaks existing headless messaging and its ownership boundaries.
- Use native subagent tools for all targets: native creation/control is not a portable cross-runtime contract, and local runtimes do not all expose Cherry tools.

## Acceptance criteria

- AC1 — Disabled local Agents are absent from delegation discovery; disabling between discovery and admission cannot launch them; enabled targets reuse Agent Services configuration without inventing a Cherry model requirement. (verification: unit — discovery and local-runtime owners)
- AC2 — Delegation operates only in the explicitly selected or caller workspace, rejects stale workspace IDs, and leaves ordinary cross-Agent session defaults unchanged. (verification: unit — real database routing tests)
- AC3 — Parent UI shows correlated progress and target approvals/questions; target IDs are preserved, parent-turn completion does not lose interaction, and unavailable responses never grant permission. (verification: renderer and Electron — runtime/UI owners)
- AC4 — Queued/running/repeated cancellation, parent stop/deletion, target disablement and completion races settle the correct request once without stopping unrelated later work or waking a user-stopped parent. (verification: unit and Electron — delegation owner)
- AC5 — Crash/restart, CLI failure and timeout preserve partial history, report truthful outcomes, do not blindly replay work and do not duplicate result delivery. (verification: unit — populated database and runtime fixtures)
- AC6 — Owned legacy skills disappear only after replacement parity; same-name user skills remain intact; restart/install/update cannot reinstall retired builtins; CLI install/auth/terminal flows still work. (verification: unit and Electron — skill and CodeCli owners)
- AC7 — Real Codex, Claude Code and OpenCode each complete a bounded delegated task with correct project/model configuration and result return; supported approval/cancel paths are exercised and version-specific limits are recorded without claiming universal compatibility. (verification: Electron — integration owner)
- AC8 — Existing session delivery and native-subagent contracts pass focused regressions; the tool guide and bilingual design describe the supported caller/target boundary and recovery behavior. (verification: unit and docs gate — integration owner)

## Risks

The target CLI controls model access and protocol features; installation alone cannot prove readiness. Existing local-runtime readiness checks and error diagnostics remain authoritative. Parent-routed approvals require explicit responder ownership rather than merely clearing a headless flag. Cancellation must bind to a run, not only a session, and startup recovery must not repeat file edits. Workspace selection expands a tool schema and must preserve existing ordinary session semantics. Legacy-skill removal remains gated by real replacement evidence; a failing or unavailable CLI acceptance scenario blocks claiming full retirement readiness.
