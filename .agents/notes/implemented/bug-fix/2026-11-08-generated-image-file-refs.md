# Agent Note: Generated image message ownership and cleanup

Status: implemented

English | [中文](2026-11-08-generated-image-file-refs.zh.md)

## Problem

`generate_image` persists generated images as FileEntry rows but keeps their IDs only in tool output. Without a message reference, deleting the owning chat or agent-session message cannot cascade to those files, and `manual` cleanup policy prevents automatic reclamation.

## Decision

Chat and agent-session message services register generated tool outputs in their existing message file-ref tables with role `generated`. Plain chat validates static `tool-generate_image` and streamed `dynamic-tool` output with `generateImageOutputSchema`; the Claude Code MCP bridge returns structured image IDs that remain in its dynamic tool output through message projection. The role is allowed by both table constraints.

Direct AI SDK calls create outputs with `delete_when_unreferenced`. The message ref protects each output while its message exists; deleting the message cascades the ref, after which the normal cleanup pass may reclaim the file. MCP calls explicitly use `manual`: Pi codemode returns an outer result that does not yet establish ownership for nested generated images. Native Claude projection now retains the SDK structured-result sidecar for a single identified tool result; ambiguous or failed results do not borrow that sidecar.

## Alternatives considered

- Keep `manual`: preserves files while unreferenced but makes them permanent and leaves deleted-message outputs orphaned.
- Emit duplicate file parts: existing tool-result rendering already displays the image, so another file part would render it twice.

## Consequences

Direct-chat generated files follow message ownership. MCP-generated originals remain manually retained even after their message is deleted, until nested ownership is implemented for every caller. Automatic cleanup still requires the normal grace window and absence of every persistent reference.

## Verification

- Regression — `src/main/data/services/__tests__/MessageService.test.ts`: generated tool output creates one `generated` ref per persisted image.
- Regression — `src/main/data/services/__tests__/AgentSessionMessageService.test.ts`: structured MCP output creates generated refs and message deletion cascades them.
- Regression — `src/main/data/services/__tests__/FileEntryService.test.ts`: a generated image is excluded from GC while its message ref exists and becomes eligible after message deletion.
- Regression — `src/main/ai/runtime/claudeCode/__tests__/ClaudeMessageMetadata.test.ts`: structured MCP output survives metadata decoration.
- Regression — `src/main/ai/mcp/servers/__tests__/cherryBuiltinTools.test.ts` and `src/main/ai/tools/adapters/aiSdk/builtin/__tests__/PaintingTool.test.ts`: MCP output exposes image IDs and remains manual, while direct AI SDK generation uses automatic cleanup.
- Regression — `pnpm db:migrations:check`: generated role constraints are represented by an appended migration.
