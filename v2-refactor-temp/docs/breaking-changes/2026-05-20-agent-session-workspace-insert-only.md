---
title: An agent session's workspace can no longer be changed after creation
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-20
---

## What changed

When a user creates an agent session, the chosen workspace (directory)
is locked in for the lifetime of that session. The session settings UI
no longer offers a control to switch to a different directory.

The schema enforces this: `UpdateSessionDto` deliberately omits
`workspaceId`; the DataApi rejects requests that try to PATCH it.

## Why this matters to the user

Users who in v1 changed an agent's accessible path mid-conversation
will not find that affordance in v2. The conversation history and
session state stay tied to the directory they were created against.

## What the user should do

To work on a different directory with the same agent, create a new
session with the new workspace. Sessions sharing an agent share all
cognitive config — only the workspace differs.

The session list groups sessions by parent agent, so multiple sessions
per agent (one per workspace) remain manageable.

## Notes for release manager

This is part of the workspace normalization theme — see also
[`2026-05-19-agent-session-primary-workspace.md`](./2026-05-19-agent-session-primary-workspace.md)
(single workspace per migrated session) and
[`2026-05-20-agent-session-config-flattened-to-agent.md`](./2026-05-20-agent-session-config-flattened-to-agent.md)
(per-session config moved to the agent).
