# Data System Reference

This is the main entry point for Cherry Studio's data management documentation. The application uses three distinct data systems based on data characteristics.

## Quick Navigation

### System Overview (Architecture)
- [Cache Overview](./cache-overview.md) - Three-tier caching architecture
- [Preference Overview](./preference-overview.md) - User settings management
- [DataApi Overview](./data-api-overview.md) - Business data API architecture

### Usage Guides (Code Examples)
- [Cache Usage](./cache-usage.md) - useCache hooks, CacheService examples
- [Preference Usage](./preference-usage.md) - usePreference hook, PreferenceService examples
- [DataApi in Renderer](./data-api-in-renderer.md) - useQuery/useMutation, DataApiService
- [DataApi in Main](./data-api-in-main.md) - Handlers, Services, Repositories patterns

### Reference Guides (Coding Standards)
- [API Design Guidelines](./api-design-guidelines.md) - RESTful design rules
- [Database Patterns](./database-patterns.md) - DB naming, schema patterns
- [API Types](./api-types.md) - API type system, schemas, error handling
- [V2 Migration Guide](./v2-migration-guide.md) - Migration system

---

## Choosing the Right System

### Quick Decision Table

| Service | Data Characteristics | Lifecycle | Data Loss Impact | Examples |
|---------|---------------------|-----------|------------------|----------|
| **CacheService** | Regenerable, temporary | ≤ App process or survives restart | None to minimal | API responses, computed results, UI state |
| **PreferenceService** | User settings, key-value | Permanent until changed | Low (can rebuild) | Theme, language, font size, shortcuts |
| **DataApiService** | Business data, structured | Permanent | **Severe** (irreplaceable) | Topics, messages, files, knowledge base |

### Decision Flowchart

Ask these questions in order:

1. **Can this data be regenerated or lost without affecting the user?**
   - Yes → **CacheService**
   - No → Continue to #2

2. **Is this a user-configurable setting that affects app behavior?**
   - Yes → Does it have a fixed key and stable value structure?
     - Yes → **PreferenceService**
     - No (structure changes often) → **DataApiService**
   - No → Continue to #3

3. **Is this business data created/accumulated through user activity?**
   - Yes → **DataApiService**
   - No → Reconsider #1 (most data falls into one of these categories)

---

## System Characteristics

### CacheService - Runtime & Cache Data

Use CacheService when:
- Data can be **regenerated or lost without user impact**
- No backup or cross-device synchronization needed
- Lifecycle is tied to component, window, or app session

**Two sub-categories**:
1. **Performance cache**: Computed results, API responses, expensive calculations
2. **UI state cache**: Temporary settings, scroll positions, panel states

**Three tiers based on persistence needs**:
- `useCache` (memory): Lost on app restart, component-level sharing
- `useSharedCache` (shared): Cross-window sharing, lost on restart
- `usePersistCache` (persist): Survives app restarts via localStorage

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

---

## Common Anti-patterns

| Wrong Choice | Why It's Wrong | Correct Choice |
|--------------|----------------|----------------|
| Storing AI provider configs in Cache | User loses configured providers on restart | **PreferenceService** |
| Storing conversation history in Preferences | Unbounded growth, complex structure | **DataApiService** |
| Storing topic list in Preferences | User-created records, can grow large | **DataApiService** |
| Storing theme/language in DataApi | Overkill for simple key-value settings | **PreferenceService** |
| Storing API responses in DataApi | Regenerable data, doesn't need persistence | **CacheService** |
| Storing window positions in Preferences | Can be lost without impact | **CacheService** (persist tier) |

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
│   React Hooks   │  ← useDataApi, usePreference, useCache
└─────────┬───────┘
          │
┌─────────▼───────┐
│    Services     │  ← DataApiService, PreferenceService, CacheService
└─────────┬───────┘
          │
┌─────────▼───────┐
│   IPC Layer     │  ← Main Process Communication
└─────────────────┘
```

## Related Source Code

### Type Definitions
- `packages/shared/data/api/` - API type system
- `packages/shared/data/cache/` - Cache type definitions
- `packages/shared/data/preference/` - Preference type definitions

### Main Process Implementation
- `src/main/data/api/` - API server and handlers
- `src/main/data/CacheService.ts` - Cache service
- `src/main/data/PreferenceService.ts` - Preference service
- `src/main/data/db/` - Database schemas

### Renderer Process Implementation
- `src/renderer/src/data/DataApiService.ts` - API client
- `src/renderer/src/data/CacheService.ts` - Cache service
- `src/renderer/src/data/PreferenceService.ts` - Preference service
- `src/renderer/src/data/hooks/` - React hooks
