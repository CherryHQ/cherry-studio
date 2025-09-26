# Inputbar Unification Plan

## Goal
Create a single configurable input bar that supports chat topics, agent sessions, and other contexts (e.g. mini window) without duplicating UI logic. Remove `AgentSessionInputbar.tsx` in favour of the shared implementation.

## Tasks

### 1. Configuration Layer
- [x] Add `InputbarScope` registry (e.g. `src/renderer/src/config/registry/inputbar.ts`).
- [x] Define per-scope options (features toggles, placeholders, min/max rows, token counter, quick panel, attachments, knowledge picker, mention models, translate button, abort button, etc.).
- [x] Register defaults for chat (`TopicType.Chat`), agent session (`TopicType.Session`), and mini window scope.

### 2. InputbarTools Registry System (NEW)
- [x] Create `ToolDefinition` interface with key, label, icon, condition, dependencies, and render function
- [x] Implement tool registration mechanism in `src/renderer/src/config/registry/inputbarTools.ts`
- [x] Create `InputbarToolsProvider` for shared state management (files, mentionedModels, knowledgeBases, etc.)
- [x] Define tool context interfaces (`ToolContext`, `ToolRenderContext`) for dependency injection
- [x] Migrate existing tools to registry-based definitions:
  - [x] new_topic tool
  - [x] attachment tool  
  - [x] thinking tool
  - [x] web_search tool
  - [x] url_context tool
  - [x] knowledge_base tool
  - [x] mcp_tools tool
  - [x] generate_image tool
  - [x] mention_models tool
  - [x] quick_phrases tool
  - [x] clear_topic tool
  - [x] toggle_expand tool
  - [x] new_context tool
- [x] Simplify InputbarTools component to use registry (reduce from 19 props to 3-5)
- [x] Integrate tool visibility/order configuration with InputbarScope

### 3. Shared UI Composer
- [x] Extract common UI from `Inputbar.tsx` into new `InputComposer` component that reads config + callbacks.
- [x] Ensure composer handles textarea sizing, focus, drag/drop, token estimation, attachments, toolbar slots based on config.
- [x] Provide controlled props for text, files, mentioned models, loading states, quick panel interactions.

### 4. Chat Wrapper Migration
- [x] Refactor `Inputbar.tsx` to:
  - [x] Resolve scope via topic type.
  - [x] Fetch config via registry.
  - [x] Supply send/abort/translate/knowledge handlers to composer.
  - [x] Remove inline UI duplication now covered by composer.
- [x] Verify chat-specific behaviour (knowledge save, auto translate, quick panel, model mentions) via config flags and callbacks.

### 5. Agent Session Wrapper Migration
- [x] Rebuild session input bar (currently `AgentSessionInputbar.tsx`) as thin wrapper using composer and session scope config.
- [x] Use session-specific hooks for message creation, model resolution, aborting, and streaming state.
- [x] Once parity confirmed, delete `AgentSessionInputbar.tsx` and update all imports.

### 6. Cross-cutting Cleanup
- [x] Remove duplicated state caches (`_text`, `_files`, `_mentionedModelsCache`) once wrappers manage persistence appropriately.
- [x] Review shared typings (`MessageInputBaseParams`, etc.) for composer compatibility (no updates required).
- [x] Ensure quick panel integration works for all scopes (guard behind config flag).

### 7. Verification
- [ ] Run `yarn build:check` (after cleaning existing lint issues in WebSearchTool/ReadTool).
- [ ] Manual QA for chat topics, agent sessions, and mini window input: send, abort, attachments, translate, quick panel triggers, knowledge save.
- [ ] Add doc entry summarising registry usage and scope configuration.

## Notes
- Aligns with the approach taken for `MessageMenubar` scope registry.
- Composer should accept refs for external focus triggers (e.g. `MessageGroup` or session auto-focus).
- Plan to remove now-unused session-specific styles/components once migration completes.

## Implementation Details

### InputbarTools Registry Architecture
**Problem**: Current InputbarTools has 19 props causing severe prop drilling and coupling.

**Solution**: Registry-based tool system with dependency injection:

```typescript
// Tool Definition
interface ToolDefinition {
  key: string
  label: string | ((t: TFunction) => string)
  icon?: React.ComponentType
  condition?: (context: ToolContext) => boolean
  visibleInScopes?: InputbarScope[]
  dependencies?: { hooks?, refs?, state? }
  render: (context: ToolRenderContext) => ReactNode
}

// Context Provider for shared state
InputbarToolsProvider manages:
- files, mentionedModels, knowledgeBases states
- setText, resizeTextArea actions
- Tool refs management

// Simplified Component Interface
InputbarTools props reduced to:
- scope: InputbarScope
- assistantId: string  
- onNewContext?: () => void
```

**Benefits**:
- Decoupled tool definitions
- Easy to add/remove tools per scope
- Type-safe dependency injection
- Maintains drag-drop functionality
- Reduces component complexity from 19 to 3-5 props
