# Agent Note: Session worktree association and sidebar indicator

Status: implemented

English | [中文](2026-11-13-session-worktree-indicator.zh.md)

## Problem

A user can ask an Agent to create a Git worktree and develop a feature there during an existing conversation. Shell creation succeeds, and later commands may explicitly enter that directory, but Cherry has no session-owned record of that choice. A shell-local `cd` does not change the runtime workspace. The sidebar therefore cannot distinguish that conversation from others in the original project.

In the motivating conversation, the Agent ran `git worktree add -b feat/session-worktree-indicator ../cherry-studio-session-worktree origin/main`, then issued commands prefixed with `cd ../cherry-studio-session-worktree &&`. This is evidence of the intended association, not an application-level workspace switch.

## Decision

The implementation keeps the session's original workspace binding and its existing message lock unchanged. It persists one optional development-worktree association per session in SQLite through the session data service, with an appended migration. It stores the canonical worktree root and repository identity; read the current branch from Git rather than trusting model-supplied labels.

The first-party `session_worktree` Agent tool is exposed to associate or clear the current session's worktree. Creation remains an ordinary shell operation; after successful creation, the Agent explicitly associates the target. Existing worktrees can also be associated on user request. The tool derives session identity from trusted call context, cannot target other sessions, and follows existing tool permission and approval boundaries. Guidance tells the Agent to associate a worktree when it adopts one for this task, not merely when it creates a directory.

Main validates with Git using argument arrays, canonical paths, and the common Git directory. Accept only an existing linked worktree in the repository containing the original workspace; reject the primary checkout, unrelated repositories, and ordinary directories. Resolve relative inputs against the original workspace. A rejected request leaves the previous association unchanged. Git operations happen outside synchronous database transactions; the service verifies the session's original binding has not changed before committing.

The sidebar uses session list data to show a small rightward split-arrow icon immediately before the conversation name in the screenshot's leading slot. Unassociated rows keep their existing appearance. Use existing UI primitives and localized accessible text; hovering identifies the directory and current branch, including detached HEAD. Refresh Git-derived status on association, session activation, and before a new turn, not on every row render. Invalid associations retain the saved path but show an unavailable state instead of a healthy indicator.

The runtime provides the verified association in subsequent Agent context, including after resume and compaction. Tell the Agent to use explicit worktree paths or per-command working directories for development. This first version does not hot-swap native runtime cwd, silently broaden file permissions, rewrite native history, relocate session artifacts, or change the file pane's root. Association is a recorded development target, not a guarantee that every tool's default cwd has changed. Tool results and context must state this limitation. Missing or invalid targets are identified as unavailable; guidance does not silently fall back to writing in the original workspace.

An association does not bypass existing path authorization. Clearing it removes the indicator and future worktree guidance, but never deletes the directory or branch. Trashing a session does not delete its worktree. Other conversations, including ones sharing the same workspace, are unaffected. This is not a worktree manager, shell-command parser, or automatic repository-wide discovery feature. Native worktree tools in other harnesses do not count as product associations until they use this explicit contract.

## Alternatives considered

- Parse `git worktree add` and shell output: scripts, nested commands, failures, and multiple targets make creation an unreliable signal of adoption.
- Scan all worktrees in the repository: no evidence identifies which conversation owns a target, especially with concurrent sessions.
- Replace `session.workspace`: relaxes an unrelated message lock and changes runtime, file-pane, and native-history semantics beyond the requested indicator.
- Store only a transient UI flag: loses the directory, verification, restart behavior, and future context.
- Change every runtime tool's default directory immediately: requires separate native-runtime and authorization contracts; explicit paths make the first version honest and bounded.

## Consequences

A model may forget to associate a shell-created worktree. Tool guidance and an explicit success result make adoption visible, but shell parsing is deliberately not a fallback. The original workspace's repository must be discoverable; system workspaces without a repository cannot acquire this association.

Worktrees can be removed or branches changed externally. Git status is a point-in-time observation, not an execution sandbox. Revalidation is bounded to adoption, activation, and turn boundaries; existing filesystem authorization remains authoritative. A detached target is valid and must not be confused with a missing branch error.

Persisting and displaying an association does not itself grant tools access outside the original workspace. Existing approval may still be required. Transparent explicit-path guidance is essential to avoid implying a runtime cwd switch that did not occur.

## Verification

- AC1 — `SessionItem.test.tsx` and Electron PID 87829: only the associated test conversation shows the split-arrow indicator; its peer remains unassociated.
- AC2 — `AgentSessionWorktree.test.ts`: real Git fixtures cover relative paths with spaces, detached HEAD, primary checkout, missing/ordinary/unrelated targets and rejected-write preservation.
- AC3 — `AgentSessionWorktreeMigration.test.ts` and an Electron restart from PID 78555 to 87829: populated rows survive the appended migration and the saved target reloads without replacing the original workspace.
- AC4 — `agentPrompt.test.ts`, `piConnectionSignature.test.ts` and `agentSessionWarmup.test.ts`: rebuilt prompts restore the saved target, unavailable guidance forbids fallback, and association changes invalidate warm context. Electron reload confirms the original workspace and separate association remain intact; no real-provider compaction request was run.
- AC5 — `AgentSessionWorktree.test.ts` and Electron fixture removal followed by session GET: the saved path remains while status and sidebar become unavailable.
- AC6 — `AgentSessionWorktree.test.ts` and Electron clearing: strict tool input rejects another session ID, the tool requires approval, clearing removes guidance/indicator and preserves the branch and directory. Existing path authorization is unchanged.
- AC7 — `SessionItem.test.tsx` plus Electron light, dark and narrow-window screenshots under `.context/cherry-electron-dev/`: the leading icon and localized tooltip remain separate from title and existing status controls.
