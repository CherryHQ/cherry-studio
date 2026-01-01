# ChatMigrator

The `ChatMigrator` handles the largest data migration task: topics and messages from Dexie/IndexedDB to SQLite.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Topics with messages | Dexie `topics` table | `topics.json` |
| Topic metadata (name, pinned, etc.) | Redux `assistants[].topics[]` | `ReduxStateReader.getCategory('assistants')` |
| Message blocks | Dexie `message_blocks` table | `message_blocks.json` |
| Assistants (for meta) | Redux `assistants` slice | `ReduxStateReader.getCategory('assistants')` |

### Topic Data Split (Important!)

The old system stores topic data in **two separate locations**:

1. **Dexie `topics` table**: Contains only `id` and `messages[]` array (NO `assistantId`!)
2. **Redux `assistants[].topics[]`**: Contains metadata (`name`, `pinned`, `prompt`, `isNameManuallyEdited`) and implicitly the `assistantId` (from parent assistant)

Redux deliberately clears `messages[]` to reduce storage size. The migrator merges these sources:
- Messages come from Dexie
- Metadata (name, pinned, etc.) comes from Redux
- `assistantId` comes from Redux structure (each assistant owns its topics)

## Key Transformations

1. **Linear → Tree Structure**
   - Old: Messages stored as linear array in `topic.messages[]`
   - New: Tree via `parentId` + `siblingsGroupId`

2. **Multi-model Responses**
   - Old: `askId` links responses to user message, `foldSelected` marks active
   - New: Shared `parentId` + non-zero `siblingsGroupId` groups siblings

3. **Block Inlining**
   - Old: `message.blocks: string[]` (IDs) + separate `message_blocks` table
   - New: `message.data.blocks: MessageDataBlock[]` (inline JSON)

4. **Citation Migration**
   - Old: Separate `CitationMessageBlock` with `response`, `knowledge`, `memories`
   - New: Merged into `MainTextBlock.references` as `ContentReference[]`

5. **Mention Migration**
   - Old: `message.mentions: Model[]`
   - New: `MentionReference[]` in `MainTextBlock.references`

## Data Quality Handling

The migrator handles potential data inconsistencies from the old system:

| Issue | Detection | Handling |
|-------|-----------|----------|
| **Duplicate message ID** | Same ID appears in multiple topics | Generate new UUID, log warning |
| **TopicId mismatch** | `message.topicId` ≠ parent `topic.id` | Use correct parent topic.id (silent fix) |
| **Missing blocks** | Block ID not found in `message_blocks` | Skip missing block (silent) |
| **Invalid topic** | Topic missing required `id` field | Skip entire topic |
| **Missing topic metadata** | Topic not found in Redux `assistants[].topics[]` | Use Dexie values, fallback name if empty |
| **Missing assistantId** | Topic not in any `assistant.topics[]` | `assistantId` and `assistantMeta` will be null |
| **Empty topic name** | Both Dexie and Redux have empty `name` (ancient bug) | Use fallback "Unnamed Topic" |
| **Message with no blocks** | `blocks` array is empty after resolution | Skip message, re-link children to parent's parent |
| **Topic with no messages** | All messages skipped (no blocks) | Keep topic, set `activeNodeId` to null |

## Field Mappings

### Topic Mapping

Topic data is merged from Dexie + Redux before transformation:

| Source | Target (topicTable) | Notes |
|--------|---------------------|-------|
| Dexie: `id` | `id` | Direct copy |
| Redux: `name` | `name` | Merged from Redux `assistants[].topics[]` |
| Redux: `isNameManuallyEdited` | `isNameManuallyEdited` | Merged from Redux |
| Redux: (parent assistant.id) | `assistantId` | From `topicAssistantLookup` mapping |
| (from Assistant) | `assistantMeta` | Generated from assistant entity |
| Redux: `prompt` | `prompt` | Merged from Redux |
| (computed) | `activeNodeId` | Last message ID or foldSelected |
| (none) | `groupId` | null (new field) |
| (none) | `sortOrder` | 0 (new field) |
| Redux: `pinned` | `isPinned` | Merged from Redux, renamed |
| (none) | `pinnedOrder` | 0 (new field) |
| `createdAt` | `createdAt` | ISO string → timestamp |
| `updatedAt` | `updatedAt` | ISO string → timestamp |

**Dropped fields**: `type` ('chat' | 'session')

### Message Mapping

| Source (OldMessage) | Target (messageTable) | Notes |
|---------------------|----------------------|-------|
| `id` | `id` | Direct copy (new UUID if duplicate) |
| (computed) | `parentId` | From tree building algorithm |
| (from parent topic) | `topicId` | Uses parent topic.id for consistency |
| `role` | `role` | Direct copy |
| `blocks` + `mentions` + citations | `data` | Complex transformation |
| (extracted) | `searchableText` | Extracted from text blocks |
| `status` | `status` | Normalized to success/error/paused |
| (computed) | `siblingsGroupId` | From multi-model detection |
| `assistantId` | `assistantId` | Direct copy |
| `modelId` | `modelId` | Direct copy |
| (from Message.model) | `modelMeta` | Generated from model entity |
| `traceId` | `traceId` | Direct copy |
| `usage` + `metrics` | `stats` | Merged into single stats object |
| `createdAt` | `createdAt` | ISO string → timestamp |
| `updatedAt` | `updatedAt` | ISO string → timestamp |

**Dropped fields**: `type`, `useful`, `enabledMCPs`, `agentSessionId`, `providerMetadata`, `multiModelMessageStyle`, `askId` (replaced by parentId), `foldSelected` (replaced by siblingsGroupId)

### Block Type Mapping

| Old Type | New Type | Notes |
|----------|----------|-------|
| `main_text` | `MainTextBlock` | Direct, references added from citations/mentions |
| `thinking` | `ThinkingBlock` | `thinking_millsec` → `thinkingMs` |
| `translation` | `TranslationBlock` | Direct copy |
| `code` | `CodeBlock` | Direct copy |
| `image` | `ImageBlock` | `file.id` → `fileId` |
| `file` | `FileBlock` | `file.id` → `fileId` |
| `video` | `VideoBlock` | Direct copy |
| `tool` | `ToolBlock` | Direct copy |
| `citation` | (removed) | Converted to `MainTextBlock.references` |
| `error` | `ErrorBlock` | Direct copy |
| `compact` | `CompactBlock` | Direct copy |
| `unknown` | (skipped) | Placeholder blocks are dropped |

## Implementation Files

- `ChatMigrator.ts` - Main migrator class with prepare/execute/validate phases
- `mappings/ChatMappings.ts` - Pure transformation functions and type definitions

## Code Quality

All implementation code includes detailed comments:
- File-level comments: Describe purpose, data flow, and overview
- Function-level comments: Purpose, parameters, return values, side effects
- Logic block comments: Step-by-step explanations for complex logic
- Data transformation comments: Old field → new field mapping relationships
