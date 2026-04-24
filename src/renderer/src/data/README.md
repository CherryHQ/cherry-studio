# Renderer Data Layer

This directory contains the renderer process data services.

## Documentation

- **Overview**: [docs/references/data/README.md](../../../../docs/references/data/README.md)
- **Cache**: [cache-overview.md](../../../../docs/references/data/cache-overview.md) | [cache-usage.md](../../../../docs/references/data/cache-usage.md) | [cache-schema-guide.md](../../../../docs/references/data/cache-schema-guide.md)
- **Preference**: [preference-overview.md](../../../../docs/references/data/preference-overview.md) | [preference-usage.md](../../../../docs/references/data/preference-usage.md)
- **DataApi**: [data-api-in-renderer.md](../../../../docs/references/data/data-api-in-renderer.md)

## Directory Structure

```
src/renderer/src/data/
├── DataApiService.ts       # User Data API service
├── PreferenceService.ts    # Preferences management
├── CacheService.ts         # Three-tier caching system
└── hooks/
    ├── useDataApi.ts       # useQuery, useMutation, useInfiniteQuery, usePaginatedQuery, useReadCache, useWriteCache, useInvalidateCache, prefetch
    ├── useReorder.ts       # optimistic drag-and-drop reordering
    ├── usePreference.ts    # usePreference, usePreferences
    └── useCache.ts         # useCache, useSharedCache, usePersistCache
```

## Quick Start

```typescript
// Data API
import { useQuery, useMutation } from '@data/hooks/useDataApi'
const { data } = useQuery('/topics')
const { trigger: createTopic } = useMutation('/topics', 'POST')

// Preferences
import { usePreference } from '@data/hooks/usePreference'
const [theme, setTheme] = usePreference('app.theme.mode')

// Cache (three-tier renderer cache)
import { useCache, useSharedCache, usePersistCache } from '@data/hooks/useCache'
const [counter, setCounter] = useCache('ui.counter', 0)

// Non-reactive DataApi cache control (snapshot read / overlay write / invalidate)
import { useReadCache, useWriteCache, useInvalidateCache } from '@data/hooks/useDataApi'
```

### Reordering sortable resources

For any resource that exposes drag-and-drop ordering, use `useReorder` — it
handles optimistic updates, PATCH dispatch, revalidation, and rollback on top
of `useMutation`.

```tsx
const { data } = useQuery('/mcp-servers')
const { applyReorderedList } = useReorder('/mcp-servers')
return <DraggableList items={data?.items ?? []} onReorder={applyReorderedList} />
```

The full end-to-end design — database schema helpers, API endpoint composition,
service-layer helpers (`insertWithOrderKey` / `insertManyWithOrderKey` / `applyMoves` /
`resetOrder`), migrator helpers, renderer integration, migration checklist, FAQ
— lives in the **[Reorder Guide](../../../../docs/references/data/data-ordering-guide.md)**.
The guide is the canonical reference for both main- and renderer-side work.
