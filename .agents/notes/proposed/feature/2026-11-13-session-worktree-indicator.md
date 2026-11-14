# Agent Note: Session worktree association and sidebar indicator

Status: proposed

English | [中文](2026-11-13-session-worktree-indicator.zh.md)

## Problem

A user can ask an Agent to create a Git worktree and develop a feature there during an existing conversation. Shell creation succeeds, and later commands may explicitly enter that directory, but Cherry has no session-owned record of that choice. A shell-local `cd` does not change the runtime workspace. The sidebar therefore cannot distinguish that conversation from others in the original project.

In the motivating conversation, the Agent ran `git worktree add -b feat/session-worktree-indicator ../cherry-studio-session-worktree origin/main`, then issued commands prefixed with `cd ../cherry-studio-session-worktree &&`. This is evidence of the intended association, not an application-level workspace switch.

## Proposal

Keep the session's original workspace binding and its existing message lock unchanged. Persist one optional development-worktree association per session in SQLite through the session data service, with an appended migration. Store the canonical worktree root and repository identity; read the current branch from Git rather than trusting model-supplied labels.

Expose a first-party Agent tool to associate or clear the current session's worktree. Creation remains an ordinary shell operation; after successful creation, the Agent explicitly associates the target. Existing worktrees can also be associated on user request. The tool derives session identity from trusted call context, cannot target other sessions, and follows existing tool permission and approval boundaries. Guidance tells the Agent to associate a worktree when it adopts one for this task, not merely when it creates a directory.

Main validates with Git using argument arrays, canonical paths, and the common Git directory. Accept only an existing linked worktree in the repository containing the original workspace; reject the primary checkout, unrelated repositories, and ordinary directories. Resolve relative inputs against the original workspace. A rejected request leaves the previous association unchanged. Git operations happen outside synchronous database transactions; the service verifies the session's original binding has not changed before committing.

The sidebar uses session list data to show a small branch-tree icon immediately before the conversation name in the screenshot's leading slot. Unassociated rows keep their existing appearance. Use existing UI primitives and localized accessible text; hovering identifies the directory and current branch, including detached HEAD. Refresh Git-derived status on association, session activation, and before a new turn, not on every row render. Invalid associations retain the saved path but show an unavailable state instead of a healthy indicator.

Provide the verified association in subsequent Agent context, including after resume and compaction. Tell the Agent to use explicit worktree paths or per-command working directories for development. This first version does not hot-swap native runtime cwd, silently broaden file permissions, rewrite native history, relocate session artifacts, or change the file pane's root. Association is a recorded development target, not a guarantee that every tool's default cwd has changed. Tool results and context must state this limitation. Missing or invalid targets are identified as unavailable; guidance does not silently fall back to writing in the original workspace.

An association does not bypass existing path authorization. Clearing it removes the indicator and future worktree guidance, but never deletes the directory or branch. Trashing a session does not delete its worktree. Other conversations, including ones sharing the same workspace, are unaffected. This is not a worktree manager, shell-command parser, or automatic repository-wide discovery feature. Native worktree tools in other harnesses do not count as product associations until they use this explicit contract.

## Alternatives considered

- Parse `git worktree add` and shell output: scripts, nested commands, failures, and multiple targets make creation an unreliable signal of adoption.
- Scan all worktrees in the repository: no evidence identifies which conversation owns a target, especially with concurrent sessions.
- Replace `session.workspace`: relaxes an unrelated message lock and changes runtime, file-pane, and native-history semantics beyond the requested indicator.
- Store only a transient UI flag: loses the directory, verification, restart behavior, and future context.
- Change every runtime tool's default directory immediately: requires separate native-runtime and authorization contracts; explicit paths make the first version honest and bounded.

## Acceptance criteria

- AC1 — After shell creation and successful association, only the calling session shows a leading branch-tree icon; ordinary sessions and sessions that merely create a worktree remain unchanged. (verification: renderer and Electron; owner: sidebar implementer)
- AC2 — Real Git fixtures accept an existing linked worktree in the original repository, including paths with spaces and detached HEAD; primary checkouts, missing paths, ordinary folders, and unrelated repositories are rejected without changing an existing association. (verification: main unit and database; owner: session data implementer)
- AC3 — The association survives restart and list reload without changing the original workspace; migration-forward preserves populated session rows and unrelated sessions. (verification: database and Electron; owner: session data implementer)
- AC4 — Subsequent turns and resumed or compacted context identify the verified target and require explicit worktree paths, while native default cwd, existing access restrictions, and session artifact locations remain unchanged. (verification: focused runtime tests and Electron; owner: runtime implementer)
- AC5 — Removing or invalidating the linked worktree produces an unavailable indicator and context after activation or the next turn; no healthy status or guidance silently redirects development to the original directory. (verification: main, renderer, and Electron; owner: runtime implementer)
- AC6 — Clearing an association removes its icon and future guidance without deleting Git data; the tool cannot modify another session or bypass tool approval and filesystem permissions. (verification: main tool and database tests; owner: tool implementer)
- AC7 — The leading icon and localized tooltip remain legible without obscuring session names or existing running and approval states in dark, light, and narrow sidebar layouts. (verification: renderer and Electron; owner: sidebar implementer)

## Risks

A model may forget to associate a shell-created worktree. Tool guidance and an explicit success result make adoption visible, but shell parsing is deliberately not a fallback. The original workspace's repository must be discoverable; system workspaces without a repository cannot acquire this association.

Worktrees can be removed or branches changed externally. Git status is a point-in-time observation, not an execution sandbox. Revalidation is bounded to adoption, activation, and turn boundaries; existing filesystem authorization remains authoritative. A detached target is valid and must not be confused with a missing branch error.

Persisting and displaying an association does not itself grant tools access outside the original workspace. Existing approval may still be required. Transparent explicit-path guidance is essential to avoid implying a runtime cwd switch that did not occur.
