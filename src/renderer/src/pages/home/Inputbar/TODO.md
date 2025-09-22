# Inputbar Unification Plan

## Goal
Create a single configurable input bar that supports chat topics, agent sessions, and other contexts (e.g. mini window) without duplicating UI logic. Remove `AgentSessionInputbar.tsx` in favour of the shared implementation.

## Tasks

### 1. Configuration Layer
- [ ] Add `InputbarScope` registry (e.g. `src/renderer/src/config/registry/inputbar.ts`).
- [ ] Define per-scope options (features toggles, placeholders, min/max rows, token counter, quick panel, attachments, knowledge picker, mention models, translate button, abort button, etc.).
- [ ] Register defaults for chat (`TopicType.Chat`), agent session (`TopicType.Session`), and mini window scope.

### 2. Shared UI Composer
- [ ] Extract common UI from `Inputbar.tsx` into new `InputComposer` component that reads config + callbacks.
- [ ] Ensure composer handles textarea sizing, focus, drag/drop, token estimation, attachments, toolbar slots based on config.
- [ ] Provide controlled props for text, files, mentioned models, loading states, quick panel interactions.

### 3. Chat Wrapper Migration
- [ ] Refactor `Inputbar.tsx` to:
  - Resolve scope via topic type.
  - Fetch config via registry.
  - Supply send/abort/translate/knowledge handlers to composer.
  - Remove inline UI duplication now covered by composer.
- [ ] Verify chat-specific behaviour (knowledge save, auto translate, quick panel, model mentions) via config flags and callbacks.

### 4. Agent Session Wrapper Migration
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
