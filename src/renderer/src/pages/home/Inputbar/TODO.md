# Inputbar Unification Plan

## Goal
Create a single configurable input bar that supports chat topics, agent sessions, and other contexts (e.g. mini window) without duplicating UI logic. Remove `AgentSessionInputbar.tsx` in favour of the shared implementation.

## Tasks

### 1. Configuration Layer
- [ ] Add `InputbarScope` registry (e.g. `src/renderer/src/config/registry/inputbar.ts`).
- [ ] Define per-scope options (features toggles, placeholders, min/max rows, token counter, quick panel, attachments, knowledge picker, mention models, translate button, abort button, etc.).
- [ ] Register defaults for chat (`TopicType.Chat`), agent session (`TopicType.Session`), and mini window scope.

### 2. InputbarTools Registry System (NEW)
- [ ] Create `ToolDefinition` interface with key, label, icon, condition, dependencies, and render function
- [ ] Implement tool registration mechanism in `src/renderer/src/config/registry/inputbarTools.ts`
- [ ] Create `InputbarToolsProvider` for shared state management (files, mentionedModels, knowledgeBases, etc.)
- [ ] Define tool context interfaces (`ToolContext`, `ToolRenderContext`) for dependency injection
- [ ] Migrate existing tools to registry-based definitions:
  - [ ] new_topic tool
  - [ ] attachment tool  
  - [ ] thinking tool
  - [ ] web_search tool
  - [ ] url_context tool
  - [ ] knowledge_base tool
  - [ ] mcp_tools tool
  - [ ] generate_image tool
  - [ ] mention_models tool
  - [ ] quick_phrases tool
  - [ ] clear_topic tool
  - [ ] toggle_expand tool
  - [ ] new_context tool
- [ ] Simplify InputbarTools component to use registry (reduce from 19 props to 3-5)
- [ ] Integrate tool visibility/order configuration with InputbarScope

### 3. Shared UI Composer
- [ ] Extract common UI from `Inputbar.tsx` into new `InputComposer` component that reads config + callbacks.
- [ ] Ensure composer handles textarea sizing, focus, drag/drop, token estimation, attachments, toolbar slots based on config.
- [ ] Provide controlled props for text, files, mentioned models, loading states, quick panel interactions.

### 4. Chat Wrapper Migration
- [ ] Refactor `Inputbar.tsx` to:
  - Resolve scope via topic type.
  - Fetch config via registry.
  - Supply send/abort/translate/knowledge handlers to composer.
  - Remove inline UI duplication now covered by composer.
- [ ] Verify chat-specific behaviour (knowledge save, auto translate, quick panel, model mentions) via config flags and callbacks.

### 5. Agent Session Wrapper Migration
- [ ] Rebuild session input bar (currently `AgentSessionInputbar.tsx`) as thin wrapper using composer and session scope config.
- [ ] Use session-specific hooks for message creation, model resolution, aborting, and streaming state.
- [ ] Once parity confirmed, delete `AgentSessionInputbar.tsx` and update all imports.

### 6. Cross-cutting Cleanup
- [ ] Remove duplicated state caches (`_text`, `_files`, `_mentionedModelsCache`) once wrappers manage persistence appropriately.
- [ ] Update typings (`MessageInputBaseParams`, etc.) if composer needs shared interfaces.
- [ ] Ensure quick panel integration works for all scopes (guard behind config flag).

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
