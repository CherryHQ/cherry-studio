# Renderer Data Layer

This directory contains the renderer process data services.

## Documentation

- **Overview**: [docs/en/references/data/README.md](../../../../docs/en/references/data/README.md)
- **Cache**: [cache-overview.md](../../../../docs/en/references/data/cache-overview.md) | [cache-usage.md](../../../../docs/en/references/data/cache-usage.md)
- **Preference**: [preference-overview.md](../../../../docs/en/references/data/preference-overview.md) | [preference-usage.md](../../../../docs/en/references/data/preference-usage.md)
- **DataApi**: [data-api-in-renderer.md](../../../../docs/en/references/data/data-api-in-renderer.md)

## Directory Structure

```
src/renderer/src/data/
├── DataApiService.ts       # User Data API service
├── PreferenceService.ts    # Preferences management
├── CacheService.ts         # Three-tier caching system
└── hooks/
    ├── useDataApi.ts       # useQuery, useMutation
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

// Cache
import { useCache, useSharedCache, usePersistCache } from '@data/hooks/useCache'
const [counter, setCounter] = useCache('ui.counter', 0)
```
