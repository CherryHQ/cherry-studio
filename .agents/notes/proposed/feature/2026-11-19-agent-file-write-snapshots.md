# Agent Note: Agent file write snapshots

Status: proposed

English | [中文](2026-11-19-agent-file-write-snapshots.zh.md)

## Problem

Agent file writes can overwrite uncommitted user changes or create unwanted files. Without a pre-write baseline, the user cannot recover overwritten work through the session. Undo must also avoid destroying changes made after the agent wrote a file and distinguish full recovery from partial failure.

## Proposal

For supported agent writes, capture the file's baseline before writing and associate it with the accepted turn's replyId. A file written repeatedly in the same turn keeps only its first baseline; a later turn has its own baseline. A missing file is recorded as absent so undo can remove a file created by that turn. Record write outcomes and use the existing approval flow for dangerous or undecidable writes; denial prevents the write.

The session action offers undo for the turn, lists affected files and asks for confirmation. Main owns paths and validates reply, revision and file state; the renderer cannot choose paths. Restore a safe baseline or remove a safely created file, preserve conflicts, report partial failures and permit safe retry. Keep snapshots until the session is permanently deleted, including while it is retained or recoverable.

## Key mechanisms

- The pre-write baseline stores raw bytes, the full mode bits and the parent identity. The post-write state is the hash of the content the tool input implies, never a sample taken from disk, so a user save that lands between the agent write and settlement is reported as a conflict instead of being overwritten or deleted.
- Undo requires a finished turn, a matching revision, a per-file state check, and a live runtime attestation of the current turn; a snapshot pointer found on disk after a restart is not trusted on its own.
- A pending attempt that never settled is cancelled only after 120 seconds and only while its target still matches the baseline; otherwise it keeps blocking undo.
- The snapshot root is refused when it would land inside any registered agent workspace, and the dangerous-write confirmation cannot be bypassed by permission mode, headless runs or timeouts.

This protection does not cover writes by `bash`, shell or subprocesses, CLI, automation, external MCP, or the built-in filesystem MCP. It is not a general backup.

## Alternatives considered

- Git alone excludes unversioned workspaces and may affect unrelated changes; snapshots preserve the state seen before the supported write.
- Blind restoration could overwrite later user work; conflict checks favor preservation over automatic completion.
- Full history and diff browsing would add scope and complexity; this proposal offers turn-level undo only.
- TTL or capacity eviction could silently remove the only recovery baseline before the user needs it; session-lifetime retention trades disk space for predictable availability.

## Acceptance criteria

- AC1 — Repeated supported writes to a file in one turn can be undone to its state before the first write, including removal of a newly created file; a later turn restores its own baseline. (verification: unit — runtime and snapshot owners)
- AC2 — A dangerous or undecidable supported write requests confirmation, and denying it leaves the file unchanged. (verification: unit — runtime owner)
- AC3 — Undo preserves files changed after the agent write, reports conflicts or partial failures, and allows safe retry. (verification: unit — snapshot owner)
- AC4 — A session lists affected files and asks for confirmation before undoing the selected turn; the result distinguishes success from partial failure. (verification: Electron — desktop owner)
- AC5 — Snapshots remain available while a session is retained and are removed when it is permanently deleted. (verification: unit — snapshot owner)
- AC6 — A supported interactive agent write can be undone from the session to recover the prior file content. (verification: Electron — desktop owner)

## Risks

Snapshots consume disk until permanent session deletion. Filesystem validation leaves a time-of-check-to-time-of-use (TOCTOU) window; identical-content replacement during a pending write may be indistinguishable. Concurrent external writes or interrupted persistence can leave ambiguous outcomes. Unsupported write paths remain unprotected. Future work may consider history or diff views and an explicit storage policy, provided it does not silently invalidate the retention promise.
