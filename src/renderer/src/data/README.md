# Data Layer - Renderer Process

This directory contains the unified data access layer for Cherry Studio's renderer process, providing type-safe interfaces for data operations, preference management, and caching.

## Overview

The `src/renderer/src/data` directory implements the new data architecture as part of the ongoing database refactoring project. It provides three core services that handle all data operations in the renderer process:

- **DataApiService**: RESTful-style API for communication with the main process
- **PreferenceService**: Unified preference/configuration management with real-time sync
- **CacheService**: Three-tier caching system for optimal performance

## Architecture

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

## Quick Start

### Data API Operations

```typescript
import { useQuery, useMutation } from '@data/hooks/useDataApi'

// Fetch data with auto-retry and caching
const { data, loading, error } = useQuery('/topics')

// Create/update data with optimistic updates
const { trigger: createTopic } = useMutation('/topics', 'POST')
await createTopic({ title: 'New Topic', content: 'Hello World' })
```

### Preference Management

```typescript
import { usePreference } from '@data/hooks/usePreference'

// Manage user preferences with real-time sync
const [theme, setTheme] = usePreference('app.theme.mode')
const [fontSize, setFontSize] = usePreference('chat.message.font_size')

// Optimistic updates (default)
await setTheme('dark') // UI updates immediately, syncs to database
```

### Cache Management

```typescript
import { useCache, useSharedCache, usePersistCache } from '@data/hooks/useCache'

// Component-level cache (lost on app restart)
const [count, setCount] = useCache('ui.counter')

// Cross-window cache (shared between all windows)
const [windowState, setWindowState] = useSharedCache('window.layout')

// Persistent cache (survives app restarts)
const [recentFiles, setRecentFiles] = usePersistCache('app.recent_files')
```

## Core Services

### DataApiService

**Purpose**: Type-safe communication with the main process using RESTful-style APIs.

**Key Features**:
- Type-safe request/response handling
- Automatic retry with exponential backoff
- Batch operations and transactions
- Real-time subscriptions
- Request cancellation and timeout handling

**Basic Usage**:
```typescript
import { dataApiService } from '@data/DataApiService'

// Simple GET request
const topics = await dataApiService.get('/topics')

// POST with body
const newTopic = await dataApiService.post('/topics', {
  body: { title: 'Hello', content: 'World' }
})

// Batch operations
const responses = await dataApiService.batch([
  { method: 'GET', path: '/topics' },
  { method: 'GET', path: '/messages' }
])
```

### PreferenceService

**Purpose**: Centralized preference/configuration management with cross-window synchronization.

**Key Features**:
- Optimistic and pessimistic update strategies
- Real-time cross-window synchronization
- Local caching for performance
- Race condition handling
- Batch operations for multiple preferences

**Basic Usage**:
```typescript
import { preferenceService } from '@data/PreferenceService'

// Get single preference
const theme = await preferenceService.get('app.theme.mode')

// Set with optimistic updates (default)
await preferenceService.set('app.theme.mode', 'dark')

// Set with pessimistic updates
await preferenceService.set('api.key', 'secret', { optimistic: false })

// Batch operations
await preferenceService.setMultiple({
  'app.theme.mode': 'dark',
  'chat.message.font_size': 14
})
```

### CacheService

**Purpose**: Three-tier caching system for different data persistence needs.

**Cache Tiers**:
1. **Memory Cache**: Component-level, lost on app restart
2. **Shared Cache**: Cross-window, lost on app restart
3. **Persist Cache**: Cross-window + localStorage, survives restarts

**Key Features**:
- TTL (Time To Live) support
- Hook reference tracking (prevents deletion of active data)
- Cross-window synchronization
- Type-safe cache schemas
- Automatic default value handling

**Basic Usage**:
```typescript
import { cacheService } from '@data/CacheService'

// Memory cache (component-level)
cacheService.set('temp.calculation', result, 30000) // 30s TTL
const result = cacheService.get('temp.calculation')

// Shared cache (cross-window)
cacheService.setShared('window.layout', layoutConfig)
const layout = cacheService.getShared('window.layout')

// Persist cache (survives restarts)
cacheService.setPersist('app.recent_files', recentFiles)
const files = cacheService.getPersist('app.recent_files')
```

## React Hooks

### useDataApi

Type-safe data fetching with SWR integration.

```typescript
import { useQuery, useMutation } from '@data/hooks/useDataApi'

// GET requests with auto-caching
const { data, loading, error, mutate } = useQuery('/topics', {
  query: { page: 1, limit: 20 }
})

// Mutations with optimistic updates
const { trigger: updateTopic, isMutating } = useMutation('/topics/123', 'PUT')
await updateTopic({ title: 'Updated Title' })
```

### usePreference

Reactive preference management with automatic synchronization.

```typescript
import { usePreference } from '@data/hooks/usePreference'

// Basic usage with optimistic updates
const [theme, setTheme] = usePreference('app.theme.mode')

// Pessimistic updates for critical settings
const [apiKey, setApiKey] = usePreference('api.key', { optimistic: false })

// Handle updates
const handleThemeChange = async (newTheme) => {
  try {
    await setTheme(newTheme) // Auto-rollback on failure
  } catch (error) {
    console.error('Theme update failed:', error)
  }
}
```

### useCache Hooks

Component-friendly cache management with automatic lifecycle handling.

```typescript
import { useCache, useSharedCache, usePersistCache } from '@data/hooks/useCache'

// Memory cache (useState-like, but shared between components)
const [counter, setCounter] = useCache('ui.counter', 0)

// Shared cache (cross-window)
const [layout, setLayout] = useSharedCache('window.layout')

// Persistent cache (survives restarts)
const [recentFiles, setRecentFiles] = usePersistCache('app.recent_files')
```

## Best Practices

### When to Use Which Service

The three services map to distinct data categories based on the original architecture design. Use the following guide to choose the right service.

#### Quick Decision Table

| Service | Data Characteristics | Lifecycle | Data Loss Impact | Examples |
|---------|---------------------|-----------|------------------|----------|
| **CacheService** | Regenerable, temporary | ≤ App process or survives restart | None to minimal | API responses, computed results, UI state |
| **PreferenceService** | User settings, key-value | Permanent until changed | Low (can rebuild) | Theme, language, font size, shortcuts |
| **DataApiService** | Business data, structured | Permanent | **Severe** (irreplaceable) | Topics, messages, files, knowledge base |

#### CacheService - Runtime & Cache Data

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

#### PreferenceService - User Preferences

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

#### DataApiService - User Data

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

#### Decision Flowchart

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

#### Common Anti-patterns

| Wrong Choice | Why It's Wrong | Correct Choice |
|--------------|----------------|----------------|
| Storing AI provider configs in Cache | User loses configured providers on restart | **PreferenceService** |
| Storing conversation history in Preferences | Unbounded growth, complex structure | **DataApiService** |
| Storing topic list in Preferences | User-created records, can grow large | **DataApiService** |
| Storing theme/language in DataApi | Overkill for simple key-value settings | **PreferenceService** |
| Storing API responses in DataApi | Regenerable data, doesn't need persistence | **CacheService** |
| Storing window positions in Preferences | Can be lost without impact | **CacheService** (persist tier) |

#### Edge Cases

- **Recently used items** (e.g., recent files, recent searches): Use `usePersistCache` - nice to have but not critical if lost
- **Draft content** (e.g., unsaved message): Use `useSharedCache` for cross-window, consider auto-save to DataApi for recovery
- **Computed statistics**: Use `useCache` with TTL - regenerate when expired
- **User-created templates/presets**: Use **DataApiService** - user-generated content that can grow

### Performance Guidelines

1. **Prefer React Hooks**: Use `useQuery`, `usePreference`, `useCache` for component integration
2. **Batch Operations**: Use `setMultiple()` for updating multiple preferences
3. **Cache Strategically**: Use appropriate cache tiers based on data lifetime needs
4. **Optimize Re-renders**: SWR and useSyncExternalStore minimize unnecessary re-renders

### Common Patterns

```typescript
// Loading states with error handling
const { data, loading, error } = useQuery('/topics')
if (loading) return <Loading />
if (error) return <Error error={error} />

// Form handling with preferences
const [fontSize, setFontSize] = usePreference('chat.message.font_size')
const handleChange = (e) => setFontSize(Number(e.target.value))

// Temporary state with caching
const [searchQuery, setSearchQuery] = useCache('search.current_query', '')
const [searchResults, setSearchResults] = useCache('search.results', [])
```

## Type Safety

All services provide full TypeScript support with auto-completion and type checking:

- **API Types**: Defined in `@shared/data/api/`
- **Preference Types**: Defined in `@shared/data/preference/`
- **Cache Types**: Defined in `@shared/data/cache/`

Type definitions are automatically inferred, providing:
- Request/response type safety
- Preference key validation
- Cache schema enforcement
- Auto-completion in IDEs

## Migration from Legacy Systems

This new data layer replaces multiple legacy systems:
- Redux-persist slices → PreferenceService
- localStorage direct access → CacheService
- Direct IPC calls → DataApiService
- Dexie database operations → DataApiService

For migration guidelines, see the project's `.claude/` directory documentation.

## File Structure

```
src/renderer/src/data/
├── DataApiService.ts       # User Data API querying service
├── PreferenceService.ts    # Preferences management
├── CacheService.ts         # Three-tier caching system
└── hooks/
    ├── useDataApi.ts       # React hooks for user data operations
    ├── usePreference.ts    # React hooks for preferences
    └── useCache.ts         # React hooks for caching
```

## Related Documentation

- **API Schemas**: `packages/shared/data/` - Type definitions and API contracts
- **Architecture Design**: `.claude/data-architecture.md` - Detailed system design
- **Migration Guide**: `.claude/migration-planning.md` - Legacy system migration
- **Project Overview**: `CLAUDE.local.md` - Complete refactoring context