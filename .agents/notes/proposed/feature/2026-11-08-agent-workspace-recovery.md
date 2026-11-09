# Agent Note: Agent work directory recovery

Status: proposed

English | [中文](2026-11-08-agent-workspace-recovery.zh.md)

## Problem

An Agent keeps a saved work directory. When that directory does not exist on the current machine, for example after a backup restore or device migration, a folder rename or deletion, or a disconnected external drive, the Agent has no in-place recovery path:

- Skill loading can stay in a loading state without saying that the work directory is missing.
- The only signal is a tooltip warning. Nothing explains that skills and file tools cannot load, and nothing lets the user choose a new folder.
- A session that already has messages cannot change its workspace. The data layer locks the binding after the first message, so an Agent with history is stuck even when its folder is gone.

## Proposal

When an Agent's saved work directory is unreachable, Cherry Studio shows a recovery state instead of loading indefinitely, and lets the user rebind the session to a valid folder.

### Detection

- Opening an Agent, or loading its skills, checks whether the saved work directory is an accessible directory before normal skill loading continues.
- An unreachable directory ends the loading state and is treated as a recoverable condition, not a failure that retries forever.

### Recovery state

- A notice above the composer states that the work directory is unavailable, explains that skills and file tools cannot load, and shows the missing path.
- The notice has one primary action, "Choose work directory", which opens the folder picker.
- Cancelling the picker keeps the notice and the action in place. The Agent stays usable for other actions and never returns to an indefinite loading indicator.

### Rebinding

- A chosen folder is registered as a workspace, and the session is rebound to it, even when the session already has messages.
- The message lock is relaxed only in this case: the current user workspace folder is missing and the target is another user workspace. A session whose folder still exists stays locked.
- After rebinding, skill loading retries against the new folder, and the notice disappears.
- Reopening the Agent later uses the new path and does not show the notice again.

### Scenarios covered

Device migration or backup restore, a renamed or deleted folder while the app is closed, and an external drive that is disconnected. The same path applies in every case, because the only input is that the saved path is not an accessible directory.

## Alternatives considered

- **Keep the message lock and require a new session.** Rejected. It leaves migrated Agents with history without any way to continue, which is the reported problem.
- **Relax the lock for every session with messages.** Rejected. A working conversation could silently switch directories and change what its tools can read.
- **Only enable the top-bar workspace selector and keep the tooltip.** Rejected. It gives no explanation of why skills are missing and has no primary action.
- **Auto-pick a fallback folder such as the system workspace.** Rejected. It hides the change from the user and can point tools at unrelated files.

## Acceptance criteria

- AC1 — When an Agent's saved work directory is missing or not a directory, opening the Agent or loading its skills ends the loading state and shows a notice that names the unavailable directory, with the missing path. (verification: renderer; owner: Agent chat owner)
- AC2 — The unavailable notice offers one primary action to choose a work directory. Cancelling the folder picker leaves the notice, the action, and the rest of the Agent usable, with no indefinite loading indicator. (verification: renderer; owner: Agent chat owner)
- AC3 — Choosing an existing local folder registers it as a workspace and rebinds the session to it, including a session that already has messages. (verification: main data service and renderer; owner: Agent session data owner)
- AC4 — Rebinding is allowed for a session with messages only when its current user workspace folder is inaccessible. A session whose folder still exists keeps the message lock and returns an invalid-operation error when rebinding is attempted. (verification: main data service; owner: Agent session data owner)
- AC5 — After rebinding, skill loading runs against the new folder and the available skills appear. (verification: renderer; owner: skill loading owner)
- AC6 — Reopening an Agent after rebinding uses the new path and shows no unavailable notice. (verification: renderer and Electron; owner: Agent chat owner)
- AC7 — The same notice and recovery path apply after device migration, backup restore, a renamed or deleted folder, and a disconnected external drive. (verification: Electron; owner: Agent chat owner)

## Risks

- The directory type, access, and open/read checks run synchronously on the main process before the write transaction. A slow or hung network or external drive can still delay the rebind, but directory enumeration does not hold the database write transaction. The transaction rechecks that the session still uses the workspace checked by the preflight.
- A rebind changes what the Agent's tools can reach. The notice must make the new folder visible, and the user must choose it explicitly.
- The skill-loading hang is not yet reproduced. AC1 and AC5 cannot be verified until the cause is found in the running app.
- Translations for the new strings are unreviewed.
