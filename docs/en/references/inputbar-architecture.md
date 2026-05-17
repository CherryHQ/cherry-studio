# Inputbar Architecture

This document describes the `src/renderer/src/pages/home/Inputbar` architecture, including component layering, shared state, and the tool system. It covers both Chat and Agent Session inputbars.

## Goals and Scope

- The inputbar is the main entry for composing and sending messages, handling text input, attachments, tool entry points, and quick panel triggers.
- Business logic stays in the container layer, while `InputbarCore` focuses on reusable UI and interaction primitives.
- The tool system is registry-driven and can expose different tools per scope.

## Structure and Responsibilities

- `Inputbar.tsx`: Chat inputbar container, owns message sending, topic actions, token estimation, knowledge base and model mentions.
- `AgentSessionInputbar.tsx`: Agent Session inputbar container, adapts session data and slash commands with a different send flow.
- `components/InputbarCore.tsx`: core UI and interaction container, including textarea, toolbars, drag/drop, and quick panel triggers.
- `context/InputbarToolsProvider.tsx`: shared state and tool registry (tool state, triggers, root menu).
- `InputbarTools.tsx`: tool rendering and orchestration, ordering, visibility, drag sorting, QuickPanel registration.
- `hooks/`: inputbar interaction hooks (paste, drag/drop).
- `tools/`: tool definitions and QuickPanel trigger configs registered to the tool system.
- `types.ts`, `registry.ts`: scope definitions, tool types/registry, scope config.

## Layering

1) **Container layer (Inputbar / AgentSessionInputbar)**
   - Owns business logic, message sending, topic actions, model capability checks.
   - Builds `InputbarToolsProvider` initial state and actions for tools.

2) **Core UI layer (InputbarCore)**
   - Only consumes props and shared context; does not own business state.
   - Handles text input, drag/paste, quick panel triggers, translate shortcut, attachment preview.

3) **Tool system layer (InputbarToolsProvider + InputbarTools + tools/)**
   - `InputbarToolsProvider` exposes state/dispatch and the QuickPanel registry.
   - `InputbarTools` renders tool buttons and manages ordering/visibility.
   - `tools/` uses `defineTool` to declare dependencies, conditions, QuickPanel triggers, and UI renderers.

## Scope and Config

- `types.ts` defines `InputbarScope`: `TopicType.Chat`, `TopicType.Session`, `mini-window`.
- `registry.ts` supplies per-scope config: rows, tools collapsible, QuickPanel/drag toggles.
- `InputbarCore` reads config by scope to apply behavior differences.

## Main Data Flows

### Chat mode (`Inputbar.tsx`)

1. Initialize: draft from `CacheService`, last mentioned models from cache.
2. Input state: `useInputText` for text, `useTextareaResize` for height.
3. Send:
   - Upload files via `FileManager.uploadFiles`.
   - Build `MessageInputBaseParams`, estimate usage.
   - `dispatch(_sendMessage)`, clear text and attachments.
4. Quick actions: new topic, clear topic, new context emit via EventEmitter.
5. Capability checks: decide support for image/text files and Web Search.

### Agent Session mode (`AgentSessionInputbar.tsx`)

1. Load session from `useSession`, build `assistantStub`.
2. Draft persistence via `useInputText` + `CacheService`.
3. Send:
   - Do not upload files; append file paths to text.
   - Use `dispatchSendMessage` with session context.
4. Slash commands: QuickPanel shows command list and inserts into textarea.

## InputbarCore Interaction Capabilities

- **Paste**: `usePasteHandler` calls `PasteService.handlePaste` for text/image/file.
- **Drag/drop**: `useFileDragDrop` handles files and text drop with extension filtering.
- **QuickPanel**:
  - Uses `QuickPanelReservedSymbol` (`/` root, `@` mention) to trigger panels.
  - Tracks cursor/boundary to open or resume panels.
- **Keyboard**:
  - Enter sends based on shortcut setting; Shift+Enter inserts newline.
  - Esc collapses expanded input.
- **Attachments**:
  - `AttachmentPreview` renders tags.
  - Backspace removes the last attachment.

## InputbarToolsProvider Model

- **State**: `files`, `mentionedModels`, `selectedKnowledgeBases`, `isExpanded`.
- **Derived**: `couldAddImageFile`, `couldMentionNotVisionModel`, `extensions`.
- **Actions**: injected from container (resize, clearTopic, newContext, onTextChange, etc.).
- **Registry**:
  - `registerRootMenu`: collects `/` root menu entries.
  - `registerTrigger`: registers QuickPanel symbol handlers.
  - `emit` + `getRootMenu` are consumed by `InputbarCore`.

## Tool System Design

- `tools/index.ts` imports and registers all tools.
- `defineTool` declares:
  - `visibleInScopes` for scope visibility.
  - `condition` for capability checks.
  - `dependencies` to limit accessible state/actions.
  - `quickPanel` for root menu and trigger behaviors.
  - `render` for button UI (null means menu-only).

### Typical Tools

- `attachmentTool`: file upload, uses `files` and `extensions`.
- `mentionModelsTool`: @ model selection with QuickPanel manager.
- `knowledgeBaseTool`: knowledge base selection, enabled by tool capability.
- `newTopicTool` / `clearTopicTool` / `newContextTool`: topic actions.
- `toggleExpandTool`: expand/collapse input.
- `slashCommandsTool` (Session): slash command entry and triggers.

## Key UI Components

- `AttachmentPreview.tsx`: attachment tags and preview/context menu.
- `KnowledgeBaseInput.tsx`: knowledge base tag list.
- `MentionModelsInput.tsx`: model mention tag list.
- `TokenCount.tsx`: input/context token display.
- `SendMessageButton.tsx`: send button.

## Extension Tips

- New tool: create under `tools/`, call `registerTool`, and import in `tools/index.ts`.
- QuickPanel extensions: prefer declarative `quickPanel` configs.
- If hooks are needed before registering menus, use `quickPanelManager`.

## Related Files

- `src/renderer/src/pages/home/Inputbar/Inputbar.tsx`
- `src/renderer/src/pages/home/Inputbar/AgentSessionInputbar.tsx`
- `src/renderer/src/pages/home/Inputbar/components/InputbarCore.tsx`
- `src/renderer/src/pages/home/Inputbar/context/InputbarToolsProvider.tsx`
- `src/renderer/src/pages/home/Inputbar/InputbarTools.tsx`
- `src/renderer/src/pages/home/Inputbar/tools/`
- `src/renderer/src/pages/home/Inputbar/types.ts`
- `src/renderer/src/pages/home/Inputbar/registry.ts`
