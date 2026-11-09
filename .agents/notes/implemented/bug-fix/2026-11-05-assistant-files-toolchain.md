# Agent Note: Make the assistant file tools usable from the conversation

Status: implemented

English | [中文](2026-11-05-assistant-files-toolchain.zh.md)

## Problem

The built-in Assistant's `assistant-files` server exposed three dead ends. `move_to_trash` failed in all 30 recorded calls: on macOS `getProtectedTrashTargetReason` treated all of `~/Library` as application data, so every file in a user workspace stored under `~/Library/Application Support/CherryStudio-Shared-Workspaces` was refused. `save_attachment` failed in all 13 recorded calls: it resolved only the hashed `file_<digest>` handle, but the conversation shows the original filename, so the model sent the only name it could see. Both tools then replaced the real reason with `Tool execution failed`, leaving the model unable to distinguish a protected path from a bad handle or a missing parent directory.

## Decision

macOS no longer blanket-protects `~/Library`. The protected application-data containers are the sensitive Library children (Keychains, LaunchAgents, LaunchDaemons, Preferences, Cookies, Accounts, Safari, Mail, Messages, Mobile Documents, CloudStorage) plus Cherry Studio's own `Library/Application Support/CherryStudio`; the existing `app.userdata` context covers non-standard installs. A workspace under `Application Support` is therefore allowed, while `~/.ssh`, `~/Library/Keychains`, Cherry Studio's data, workspace roots, and version-control metadata remain refused.

`save_attachment` resolves its input as a handle first, then as a unique `displayName`. A duplicate display name fails with a message listing the candidate handles, because guessing could copy the wrong attachment.

`AssistantFileToolsServer.runTool` returns a sanitized `error.message` (control characters stripped, 500-character cap) instead of `Tool execution failed`, so the model can distinguish a protected path, a bad handle, a missing parent directory, and a failed read.

## Alternatives considered

- Exempt every strict child of the passed workspace: a workspace rooted at the app data directory could then trash `cherrystudio.sqlite`. Narrowing `~/Library` keeps Cherry Studio's data protected independently of where the workspace is rooted.
- Inject `file_<digest>` handles into the conversation: the handle is an internal derivation and the conversation already shows the filename; teaching the tool the visible name is the smaller change, and ambiguity is still detected.
- Keep failures opaque: the audit shows the model cannot self-correct without the reason. Only control characters and length are stripped, and the tool messages were already written without entry ids or temporary copy paths.

## Consequences

- Other applications' data under `~/Library/Application Support` is no longer blanket-protected by this guard. The tool only reaches paths the workspace contains, so the exposure is limited to a workspace rooted inside that tree.
- A duplicate display name now requires the handle; the error lists the candidates.
- Failure text can include the user-supplied path and the tool's own reason. It never includes attachment entry ids or temporary copy paths; `save_attachment` continues to replace filesystem failures with a path-based message.
- On Windows, a user workspace under `AppData` remains refused; this change narrows the macOS container only.

## Verification

- Regression — `pnpm test:main src/main/ai/tools/__tests__/moveToTrash.test.ts`: the audited `~/Library/Application Support/CherryStudio-Shared-Workspaces` workspace moves a file, while the workspace root, `~/.ssh`, `~/Library/Keychains`, and Cherry Studio's data stay refused.
- Regression — `pnpm test:main src/main/ai/tools/__tests__/saveAttachment.test.ts`: a unique display name copies the file; a duplicate asks for a handle and lists both.
- Regression — `pnpm test:main src/main/ai/mcp/servers/__tests__/AssistantFileToolsServer.test.ts`: a refused trash move and a missing attachment return their reasons instead of `Tool execution failed`.
- Regression — `pnpm typecheck:node`: main-process types compile.
