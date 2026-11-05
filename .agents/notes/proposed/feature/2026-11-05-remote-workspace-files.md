# Agent Note: Remote workspace file inspection and revision-bound chunked read

Status: proposed

English | [中文](2026-11-05-remote-workspace-files.zh.md)

## Problem

When an Agent running on Desktop generates or modifies files inside its authorized workspace (including final deliverables declared via `report_artifacts`), Mobile users cannot reliably inspect or retrieve those outputs:
1. `agent.content.read` only reads persisted message attachment parts (`${messageId}:${partIndex}`) managed by `FileManager` and cannot read files written directly to the session workspace by tools or scripts.
2. Workspace files are mutable across Agent turns, whereas historical message attachments are immutable snapshots. Without explicit file revision metadata (`mtime` + `sha256`) and precondition checks, a mobile client resuming an interrupted download or previewing a modified file could silently stitch or display stale bytes.

## Proposal

Add revision-bound workspace file metadata and chunked read endpoints to Remote Access:

### 1. Capability advertisement (`connection.hello`)
- `connection.hello` advertises `agentFilesVersion: 1` when workspace file endpoints are supported.

### 2. Workspace file metadata and chunked read (`agent.files.get` & `agent.files.read`)
- `@cherrystudio/remote-protocol` defines:
  - `agent.files.get`: accepts `{ sessionId, path }` and returns `workspaceFileMetadataSchema` (`path`, `name`, `revision`, `byteLength`, `sha256`, `updatedAt`, `mediaType?`).
  - `agent.files.read`: accepts `{ sessionId, path, expectedRevision?, offset?, length? }` (with `length` bounded by `remoteLimits.contentBytes = 24_576`) and returns `workspaceFileChunkSchema` (`revision`, `offset`, `totalBytes`, `eof`, `encoding`, `data`).

### 3. Strict workspace containment and revision verification (`agentQueries.ts`)
- Desktop resolves the target path against the session's authorized workspace root and verifies realpaths (`fs.realpath`) so relative traversal (`..`) or symlinks escaping the workspace root reject with `FORBIDDEN`.
- Non-regular files (such as directories) reject with `INVALID_ARGUMENT`.
- Desktop computes `revision = String(Math.trunc(stat.mtimeMs))`. When `expectedRevision` is supplied to `agent.files.read` and differs from the current file revision, Desktop rejects with `REVISION_EXPIRED` so clients discard stale partial buffers cleanly.

## Alternatives considered

- Exposing an unrestricted remote filesystem browser: Rejected. Remote Access grants scope access strictly to authorized Agent sessions and their workspaces, not arbitrary host directories.
- Reusing `agent.content.read` with raw filesystem paths: Rejected. `agent.content.read` is keyed by immutable message-part IDs; keeping workspace files on dedicated `agent.files.*` endpoints preserves the separation between immutable historical attachments and mutable workspace revisions.

## Acceptance criteria

- AC1 — `connection.hello` advertises `agentFilesVersion: 1`, and `@cherrystudio/remote-protocol` validates `agent.files.get` and `agent.files.read` schemas. (verification: unit — remote-protocol test maintainers, `contracts.test.ts`)
- AC2 — `agent.files.get` and `agent.files.read` return accurate metadata, SHA-256 digests, and 24 KiB base64 chunks for files inside the session workspace. (verification: unit — remote-access test maintainers, `agent.test.ts`)
- AC3 — `agent.files.read` rejects with `REVISION_EXPIRED` when `expectedRevision` does not match the current workspace file revision. (verification: unit — remote-access test maintainers, `agent.test.ts`)
- AC4 — Path traversal attempts (`..`) or symlinks escaping the session workspace reject with `FORBIDDEN`, and directory targets reject with `INVALID_ARGUMENT`. (verification: unit — remote-access test maintainers, `agent.test.ts`)

## Risks

- Path traversal or symlink escape outside the session workspace: Mitigation: Desktop resolves both the workspace root and target file via `fs.realpath` and verifies containment before reading metadata or bytes.
- Mid-transfer file modification by a running Agent turn: Mitigation: Every `agent.files.read` chunk validates `expectedRevision`, immediately aborting stale transfers with `REVISION_EXPIRED`.
