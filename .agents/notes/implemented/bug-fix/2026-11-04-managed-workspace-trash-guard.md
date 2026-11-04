# Agent Note: Permit trashing managed session workspace content

Status: implemented

English | [中文](2026-11-04-managed-workspace-trash-guard.zh.md)

## Problem

`move_to_trash` refused every target inside an app-managed Agent session workspace. These workspaces live under `<userData>/Data/Agents/system/<date>/<sessionId>`, but the guard protected all of `app.userdata` and, on Windows, the whole home `AppData` directory. Both ancestors independently classified ordinary session content as protected application data.

The model received only `Tool execution failed`. The diagnostic package retained the actual reason: `Refusing to move protected path to trash (a credential, configuration, or application-data directory)`.

## Decision

Eligibility comes from trusted workspace identity. `agentMcpServers.ts` threads `session.workspace.type` through the assistant-files server context into the executor; the type never comes from tool input. A `system` workspace exempts its strict descendants from the broad application-data containers only, including `app.userdata` and the platform's home application-data containers.

Credential directories, `cherry.home`, VCS metadata, OS directories, volume roots, symlink checks, and workspace containment retain their existing behavior. The workspace root remains refused. Detailed failures remain logged, and model-facing failure text stays opaque.

## Alternatives considered

- Exempt every target inside the passed `workspacePath`: a user-selected workspace at `<userData>/Data` could then trash `cherrystudio.sqlite`.
- Infer ownership from the `<date>/<sessionId>` directory layout: `<sessionId>.archiving` and `<sessionId>.restoring` are real app-owned recovery siblings at the same depth, so depth cannot prove workspace ownership.
- Expose the failure reason to the model: the shared failure wrapper deliberately hides absolute paths and entry ids, and an existing test pins that contract.

## Consequences

Ordinary files and directories strictly inside a `system` workspace can now reach the OS trash operation despite their application-data ancestors. Required approval and OS-trash-only behavior remain unchanged; there is no permanent-delete fallback. Protected targets, workspace roots, and paths outside the workspace still fail under the existing checks. A `user` workspace inside application data remains refused, even when its directory resembles a managed session workspace. Callers omitting the trusted type receive no exemption.

Agent host tools, including `move_to_trash`, are mounted only for builtin-role agents. The reported surface is the built-in assistant.

## Verification

- Regression — `node node_modules/vitest/vitest.mjs run --project main src/main/ai/tools/__tests__/moveToTrash.test.ts src/main/ai/mcp/servers/__tests__/AssistantFileToolsServer.test.ts src/main/ai/runtime/claudeCode/__tests__/buildMcpServers.test.ts src/main/ai/runtime/claudeCode/__tests__/settingsBuilder.test.ts --maxWorkers=1 --no-file-parallelism`: 4 files / 212 tests pass. Platform-injected guard cases cover managed content and retained protection boundaries; operation-level file and directory fixtures exercise executor wiring with the Electron trash boundary mocked.
- Regression — RED run of `moveToTrash.managed-workspace.test.ts` on a pristine copy of base commit `c4c46c97ef1c342b6accb4db63c79b53167ab46e`: 1 file / 2 tests fail. Both Windows and Darwin managed-workspace probes fail with `expected 'a credential, configuration, or application-data directory' to be undefined`, reproducing the false refusal through the base guard API.

No real OS Recycle Bin / Trash operation on a live agent session was verified in this round. The deterministic Electron attempt is blocked by Pi mounting MCP servers as `codemode`, host tools being builtin-role only, and the built-in assistant running the vendor CLI. The focused tests do not establish live-session approval or native OS trash behavior.
