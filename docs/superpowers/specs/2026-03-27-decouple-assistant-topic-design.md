# Decouple Assistant and Topic - Design Spec

## Goal

Decouple assistants from topics at the data layer. Create an independent Assistant SQLite table, clean up Topic and Message tables to remove assistant metadata coupling, and merge the legacy assistant/preset split into a single entity.

## Scope

1. New Assistant SQLite table + Service + API + Migrator
2. Topic table: remove `assistantMeta`, add FK constraint on `assistantId`
3. Message table: remove `assistantId` and `assistantMeta`
4. Merge legacy `assistants` and `presets` into one table
5. UI changes are NOT in scope

## Out of Scope

- UI changes (topic/assistant display stays as-is)
- `regularPhrases` table (depends on v2 prompt rename, done later)
- Agent vs Assistant further distinction

---

## 1. Assistant Table Schema

```sql
CREATE TABLE assistant (
  id            TEXT PRIMARY KEY,   -- uuid
  name          TEXT NOT NULL,
  prompt        TEXT DEFAULT '',    -- direct text or promptId reference
  emoji         TEXT,
  description   TEXT,
  modelIds      TEXT,               -- json: string[]
  settings      TEXT,               -- json: AssistantSettings (inference params)
  mcpMode       TEXT,               -- 'disabled' | 'auto' | 'manual'
  mcpServerIds  TEXT,               -- json: string[]
  knowledgeBaseIds TEXT,            -- json: string[]
  enableWebSearch INTEGER DEFAULT 0,
  enableMemory    INTEGER DEFAULT 0,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);
```

Tags use the existing `tagging` table with `entityType = 'assistant'`.

### Fields removed from legacy Assistant type

| Field | Reason |
|-------|--------|
| `type` | Design flaw - no assistant/agent distinction needed |
| `model` / `defaultModel` | Replaced by `modelIds[]` (multi-model parallel) |
| `messages` (AssistantMessage[]) | Feature already removed |
| `topics` | Decoupled - queried via FK on topic table |
| `tags` | Use tagging table |
| `content` / `targetLanguage` | Translation-specific, not core assistant |
| `enableGenerateImage` | No need to persist per-assistant |
| `enableUrlContext` | No need to persist per-assistant |
| `knowledgeRecognition` | Removed - if knowledgeBaseIds is non-empty, search is on |
| `webSearchProviderId` | No per-assistant meaning |
| `regularPhrases` | Future: will become FK IDs when prompt table exists |
| `source` | Not needed - built-in templates stay as static JSON files |

### Design rationale

**First principles**: An assistant is a model + manually assembled context. Only fields that define "what context to give the model" belong on the assistant entity. Capability toggles that don't affect context assembly (`enableGenerateImage`, `enableUrlContext`) are not persisted.

**Built-in templates** (`resources/data/agents-*.json`): Stay as read-only JSON files. "Installing" a template creates an assistant record in SQLite. Templates and user data are fully separated.

**Legacy merge**: v1 had `assistants[]`, `presets[]`, and `unifiedListOrder[]` in Redux. All merge into one `assistant` table. The `unifiedListOrder` was already deprecated.

---

## 2. Topic Table Changes

### Remove column: `assistantMeta`

No longer needed. Assistant data is queried from the assistant table when needed.

### Modify column: `assistantId`

- Add FK constraint: `REFERENCES assistant(id) ON DELETE SET NULL`
- Semantic change: `assistantId` now means "last used assistant"
- Updated automatically when a message is sent in this topic

### No other changes

`name`, `prompt`, `activeNodeId`, `groupId`, `sortOrder`, `isPinned`, timestamps remain unchanged.

---

## 3. Message Table Changes

### Remove column: `assistantId`

Messages associate with topics via `topicId` FK. No need for a direct assistant reference.

### Remove column: `assistantMeta`

Snapshot metadata is no longer stored on messages.

### No other changes

`topicId` FK with CASCADE delete remains the primary association.

---

## 4. Service Layer

Follow the existing TopicService pattern (direct DB access, module-level singleton export).

### AssistantService (`src/main/data/services/AssistantService.ts`)

- `getAll()` - list all assistants
- `getById(id)` - get single assistant
- `create(dto)` - create assistant
- `update(id, dto)` - update assistant
- `delete(id)` - delete assistant (topic.assistantId set to NULL via FK)

### API Handler (`src/main/data/api/handlers/assistants.ts`)

| Method | Path | Operation |
|--------|------|-----------|
| GET | `/assistants` | List all |
| GET | `/assistants/:id` | Get by ID |
| POST | `/assistants` | Create |
| PATCH | `/assistants/:id` | Update |
| DELETE | `/assistants/:id` | Delete |

### API Schema (`packages/shared/data/api/schemas/assistants.ts`)

- `CreateAssistantDto` - required: `name`; optional: all other fields
- `UpdateAssistantDto` - all fields optional
- Response type maps to shared `Assistant` type

### Shared Type (`packages/shared/data/types/assistant.ts`)

TypeScript interface matching the SQLite schema, with JSON columns typed (`modelIds: string[]`, `settings: AssistantSettings`, etc.).

---

## 5. Topic `assistantId` Auto-Update

When a message is sent in a topic, the topic's `assistantId` is updated to the current assistant. This is handled in the message sending flow:

1. User sends message with assistant X in topic T
2. After message creation, call `topicService.update(T.id, { assistantId: X.id })`

This keeps `assistantId` as a "last used" pointer without coupling topic lifecycle to assistant lifecycle.

---

## 6. Data Migration

### AssistantMigrator

Source: Redux state (`assistants[]` + `presets[]`)
Target: `assistant` table

Mapping:
- `model`/`defaultModel` -> `modelIds[]` (collect non-null model IDs, deduplicate)
- `type` -> dropped
- `messages` -> dropped
- `topics` -> dropped (already in topic table)
- `tags` -> write to `tagging` table
- `content`/`targetLanguage` -> dropped
- `enableGenerateImage`/`enableUrlContext`/`knowledgeRecognition`/`webSearchProviderId` -> dropped
- `regularPhrases` -> dropped (future: FK IDs)
- All other matching fields map directly

### Topic table migration

- Drop column `assistantMeta` (DDL via Drizzle migration)
- Add FK constraint on `assistantId` -> `assistant.id` ON DELETE SET NULL

### Message table migration

- Drop column `assistantId` (DDL via Drizzle migration)
- Drop column `assistantMeta` (DDL via Drizzle migration)

### Migration order

1. Create `assistant` table (schema migration)
2. Run AssistantMigrator (data migration)
3. Alter `topic` table - drop `assistantMeta`, add FK on `assistantId`
4. Alter `message` table - drop `assistantId`, drop `assistantMeta`

---

## 7. Impact Analysis

| Area | Impact |
|------|--------|
| User's existing assistants | Migrated to SQLite, some unused fields dropped |
| User's presets | Merged into assistant table |
| Topics | `assistantMeta` removed, FK added |
| Messages | `assistantId`/`assistantMeta` removed |
| `knowledgeRecognition` behavior | Assistants with knowledgeBases will always search (was configurable) |
| Built-in templates | Unchanged, stay as JSON files |
| UI | No changes in this scope |
