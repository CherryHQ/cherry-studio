# Data System Reference

This is the main entry point for Cherry Studio's data management documentation. The application uses four data systems based on data characteristics and loading requirements.

## Quick Navigation

### System Overview (Architecture)
- [Boot Config Overview](./boot-config-overview.md) - Early boot configuration system
- [Cache Overview](./cache-overview.md) - Three-tier caching architecture
- [Preference Overview](./preference-overview.md) - User settings management
- [DataApi Overview](./data-api-overview.md) - Business data API architecture
- [App State Overview](./app-state-overview.md) - Internal continuity markers (main-process)

### Usage Guides (Code Examples)
- [Cache Usage](./cache-usage.md) - useCache hooks, CacheService examples
- [Preference Usage](./preference-usage.md) - usePreference hook, PreferenceService examples
- [DataApi in Renderer](./data-api-in-renderer.md) - useQuery/useMutation, DataApiService
- [DataApi in Main](./data-api-in-main.md) - Handlers, Services patterns

### Reference Guides (Coding Standards)
- [API Design Guidelines](./api-design-guidelines.md) - RESTful design rules
- [Database Patterns](./database-patterns.md) - DB naming, schema patterns, [Write Serialization (`withWriteTx`)](./database-patterns.md#write-serialization-dbservicewritewritetx) — required for concurrent write paths to avoid libsql #288 SQLITE_BUSY
- [API Types](./api-types.md) - API type system, schemas, error handling
- [Cache Schema Guide](./cache-schema-guide.md) - Adding new cache keys (fixed and template)
- [Preference Schema Guide](./preference-schema-guide.md) - Adding new preference keys
- [Boot Config Schema Guide](./boot-config-schema-guide.md) - Adding new boot config keys
- [Layered Preset Pattern](./best-practice-layered-preset-pattern.md) - Presets with user overrides
- [Default Values & Nullability](./best-practice-default-values-and-nullability.md) - Column nullability rules, default value placement across DB / `$defaultFn` / service, PATCH derivation patterns
- [Ordering Guide](./data-ordering-guide.md) - Unified RESTful spec for sortable resources (fractional indexing)
- [V2 Migration Guide](./v2-migration-guide.md) - Migration system
- [Database Seeding Guide](./database-seeding-guide.md) - Seeding architecture, version strategies, adding new seeders

### Testing
- [Test Mocks](../../../tests/__mocks__/README.md) - Unified mocks for Cache, Preference, and DataApi

---

## Choosing the Right System

### Quick Decision Table

| Service               | Data Characteristics         | Lifecycle                         | Data Loss Impact           | Examples                                              |
| --------------------- | ---------------------------- | --------------------------------- | -------------------------- | ----------------------------------------------------- |
| **BootConfigService** | Process-level, pre-lifecycle | Permanent until changed           | Low (can rebuild)          | Hardware acceleration, Chromium flags, data directory |
| **CacheService**      | Regenerable, temporary       | ≤ App process or survives restart | None to minimal            | API responses, computed results, UI state             |
| **PreferenceService** | User settings, key-value     | Permanent until changed           | Low (can rebuild)          | Theme, language, font size, shortcuts                 |
| **DataApiService**    | Business data, structured    | Permanent                         | **Severe** (irreplaceable) | Topics, messages, files, knowledge base               |
| `app_state` (table)   | Internal continuity marker (main-process) | Until owner drops the key | Continuity break (re-runs a one-time flow) | Migration status, seeding journal |

### Decision Flowchart

Ask these questions in order:

1. **Must this setting be loaded before the lifecycle system takes over?**
   - Yes → **BootConfigService** (process-level flags, Chromium switches, data directory)
   - No → Continue to #2

2. **Can this data be regenerated or lost without affecting the user?**
   - Yes → **CacheService**
   - No → Continue to #3

3. **Is this a user-configurable setting that affects app behavior?**
   - Yes → Does it have a fixed key and stable value structure?
     - Yes → **PreferenceService**
     - No (structure changes often) → **DataApiService**
   - No → Continue to #4

4. **Is this business data created/accumulated through user activity?**
   - Yes → **DataApiService**
   - No → Continue to #5

5. **Is this an internal marker the app writes for itself to stay consistent across restarts (migration / seeding / one-time setup state)?**
   - Yes → **`app_state` table** (main-process; see [App State Overview](./app-state-overview.md))
   - No → Reconsider #2 (most data falls into one of these categories)

---

## System Characteristics

### BootConfigService - Early Boot Configuration

Use BootConfigService when:
- Setting must be loaded **synchronously before the lifecycle system takes over**
- Setting affects **process-level behavior** that cannot change at runtime (Chromium flags, data directory)
- Setting **cannot wait** for database initialization

**Key characteristics**:
- Synchronous file-based loading (`boot-config.json`)
- Minimal key set — only process-level configuration
- Accessed through PreferenceService (`BootConfig.*` prefix) after lifecycle starts

```typescript
// Early boot (src/main/index.ts) — direct access, only option at this stage
import { bootConfigService } from '@main/data/bootConfig'
if (bootConfigService.get('app.disable_hardware_acceleration')) {
  app.disableHardwareAcceleration()
}

// Renderer / lifecycle services — via PreferenceService (standard access)
const [disableHwAccel, setDisableHwAccel] = usePreference('BootConfig.app.disable_hardware_acceleration')
```

### CacheService - Runtime & Cache Data

Use CacheService when:
- Data can be **regenerated or lost without user impact**
- No backup or cross-device synchronization needed
- Lifecycle is tied to component, window, or app session
- You need other main-process services to react to cache changes (`subscribeChange` / `subscribeSharedChange`)

**Two sub-categories**:
1. **Performance cache**: Computed results, API responses, expensive calculations
2. **UI state cache**: Temporary settings, scroll positions, panel states

**Three tiers based on persistence needs**:
- `useCache` (memory): Lost on app restart, per-renderer (no cross-window sync)
- `useSharedCache` (shared): Cross-window sharing via Main; lost on restart
- `usePersistCache` (persist): Survives app restart via localStorage (renderer-authoritative; Main only relays IPC sync)

```typescript
// Good: Temporary computed results
const [searchResults, setSearchResults] = useCache('search.results', [])

// Good: UI state that can be lost
const [sidebarCollapsed, setSidebarCollapsed] = useSharedCache('ui.sidebar.collapsed', false)

// Good: Recent items (nice to have, not critical)
const [recentSearches, setRecentSearches] = usePersistCache('search.recent', [])
```

### PreferenceService - User Preferences

Use PreferenceService when:
- Data is a **user-modifiable setting that affects app behavior**
- Structure is key-value with **predefined keys** (users modify values, not keys)
- **Value structure is stable** (won't change frequently)
- Data loss has **low impact** (user can reconfigure)

**Key characteristics**:
- Auto-syncs across all windows
- Each preference item should be **atomic** (one setting = one key)
- Values are typically: boolean, string, number, or simple array/object

```typescript
// Good: App behavior settings
const [theme, setTheme] = usePreference('app.theme.mode')
const [language, setLanguage] = usePreference('app.language')
const [fontSize, setFontSize] = usePreference('chat.message.font_size')

// Good: Feature toggles
const [showTimestamp, setShowTimestamp] = usePreference('chat.display.show_timestamp')
```

### DataApiService - User Data

Use DataApiService when:
- Data is **business data accumulated through user activity**
- Data is **structured with dedicated schemas/tables**
- Users can **create, delete, modify records** (no fixed limit)
- Data loss would be **severe and irreplaceable**
- Data volume can be **large** (potentially GBs)

**Key characteristics**:
- No automatic window sync (fetch on demand for fresh data)
- May contain sensitive data (encryption consideration)
- Requires proper CRUD operations and transactions

```typescript
// Good: User-generated business data
const { data: topics } = useQuery('/topics')
const { trigger: createTopic } = useMutation('/topics', 'POST')

// Good: Conversation history (irreplaceable)
const { data: messages } = useQuery('/messages', { query: { topicId } })

// Good: User files and knowledge base
const { data: files } = useQuery('/files')
```

### `app_state` Table - Internal Continuity Markers

Use the `app_state` table when:
- Data is an **internal marker the app writes for itself**, not a user-facing setting
- It **must survive restarts**, and losing it would make the user **re-experience a one-time flow** (re-run migration, re-seed, repeat setup)
- It is needed at **app startup** — current consumers run at or before the lifecycle's earliest phase

**Key characteristics**:
- Main-process only; **no dedicated service** — the owner reads/writes the table via its own DB handle
- One owner per key; keys namespaced `<scope>:<name>`; **no cross-domain reads**

See [App State Overview](./app-state-overview.md) for full rules and the key registry.

---

## Common Anti-patterns

| Wrong Choice                                      | Why It's Wrong                                   | Correct Choice                  |
| ------------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| Storing AI provider configs in Cache              | User loses configured providers on restart       | **PreferenceService**           |
| Storing conversation history in Preferences       | Unbounded growth, complex structure              | **DataApiService**              |
| Storing topic list in Preferences                 | User-created records, can grow large             | **DataApiService**              |
| Storing theme/language in DataApi                 | Overkill for simple key-value settings           | **PreferenceService**           |
| Storing API responses in DataApi                  | Regenerable data, doesn't need persistence       | **CacheService**                |
| Storing window positions in Preferences           | Can be lost without impact                       | **CacheService** (persist tier) |
| Storing hardware acceleration flag in Preferences | Too late — must load before lifecycle takes over | **BootConfigService**           |
| Storing user theme in BootConfig                  | Doesn't need early boot loading                  | **PreferenceService**           |
| Using DataApi for window/process control          | No database backing, pure side effects, retry is harmful | **IPC handler**          |
| Using DataApi for external service calls          | Side effects, no CRUD semantics, timeout mismatch | **IPC handler**                |
| Using DataApi to wrap existing IPC calls          | Adds indirection without value, confuses layering | **Keep as IPC**                |
| Storing migration/seed state in Cache            | Lost on restart → user re-runs a one-time flow   | **`app_state` table**           |

## Edge Cases

- **Recently used items** (e.g., recent files, recent searches): Use `usePersistCache` - nice to have but not critical if lost
- **Draft content** (e.g., unsaved message): Use `useSharedCache` for cross-window, consider auto-save to DataApi for recovery
- **Computed statistics**: Use `useCache` with TTL - regenerate when expired
- **User-created templates/presets**: Use **DataApiService** - user-generated content that can grow

---

## Architecture Overview

```
                              ┌─────────────────┐
                              │ React Components│
                              └─────────┬───────┘
                                        │
                              ┌─────────▼───────┐
                              │   React Hooks   │  ← useDataApi, usePreference('...'),
                              └─────────┬───────┘    usePreference('BootConfig.*'), useCache
                                        │
                              ┌─────────▼───────┐
                              │    Services     │  ← DataApiService, PreferenceService, CacheService
                              └─────────┬───────┘
                                        │
                              ┌─────────▼───────┐
                              │   IPC Layer     │  ← Main Process Communication
                              └────┬────────┬───┘
                                   │        │
              ┌────────────────────▼─┐  ┌───▼──────────────────────┐
              │ PreferenceService    │  │ Other Main Services      │
              │ (routes BootConfig.* │  │ (DataApi, Cache, etc.)   │
              │  to bootConfigService│  └──────────────────────────┘
              │  for boot config keys│
              └──────────┬───────────┘
                         │
         ┌───────────────▼─────────────┐
         │ BootConfigService                       │
         │ (sync load, ~/.cherrystudio/            │
         │  boot-config.json — also used directly  │
         │  in early boot before lifecycle)        │
         └─────────────────────────────────────────┘
```

## Related Source Code

### Type Definitions
- `src/shared/data/api/` - API type system
- `src/shared/data/bootConfig/` - Boot config type definitions and schemas
- `src/shared/data/cache/` - Cache type definitions and schemas (`cacheSchemas.ts`, `cacheTypes.ts`, `cacheValueTypes.ts`, `templateKey.ts`)
- `src/shared/data/preference/` - Preference type definitions

### Main Process Implementation
- `src/main/data/bootConfig/` - Boot config service
- `src/main/data/api/` - API server and handlers
- `src/main/data/CacheService.ts` - Cache service
- `src/main/data/PreferenceService.ts` - Preference service (also routes `BootConfig.*` keys)
- `src/main/data/db/` - Database schemas

### Renderer Process Implementation
- `src/renderer/data/DataApiService.ts` - API client
- `src/renderer/data/CacheService.ts` - Cache service
- `src/renderer/data/PreferenceService.ts` - Preference service
- `src/renderer/data/hooks/` - React hooks

