# Cache System Overview

The Cache system provides a three-tier caching architecture for temporary and regenerable data across the Cherry Studio application.

## Purpose

CacheService handles data that:
- Can be **regenerated or lost without user impact**
- Requires no backup or cross-device synchronization
- Has lifecycle tied to component, window, or app session

## Three-Tier Architecture

| Tier | Scope | Persistence | Use Case |
|------|-------|-------------|----------|
| **Memory Cache** | Component-level | Lost on app restart | API responses, computed results |
| **Shared Cache** | Cross-window | Lost on app restart | Window state, cross-window coordination |
| **Persist Cache** | Cross-window + localStorage | Survives app restarts | Recent items, non-critical preferences |

### Memory Cache
- Fastest access, in-process memory
- Isolated per renderer process
- Best for: expensive computations, API response caching

### Shared Cache
- Synchronized bidirectionally between Main and all Renderer windows via IPC
- Main process maintains authoritative copy and provides initialization sync for new windows
- New windows fetch complete shared cache state from Main on startup
- Best for: window layouts, shared UI state

### Persist Cache
- Backed by localStorage in renderer
- Main process maintains authoritative copy
- Best for: recent files, search history, non-critical state

## Key Features

### TTL (Time To Live) Support
```typescript
// Cache with 30-second expiration
cacheService.set('temp.calculation', result, 30000)
```

### Hook Reference Tracking
- Prevents deletion of cache entries while React hooks are subscribed
- Automatic cleanup when components unmount

### Cross-Window Synchronization
- Shared and Persist caches sync across all windows
- Uses IPC broadcast for real-time updates
- Main process resolves conflicts

### Type Safety
- Schema-based keys for compile-time checking
- Casual methods for dynamic keys with manual typing

## Data Categories

### Performance Cache (Memory tier)
- Computed results from expensive operations
- API response caching
- Parsed/transformed data

### UI State Cache (Shared tier)
- Sidebar collapsed state
- Panel dimensions
- Scroll positions

### Non-Critical Persistence (Persist tier)
- Recently used items
- Search history
- User-customized but regenerable data

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer Process                                             │
│ ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│ │ useCache    │  │useSharedCache│ │usePersistCache│         │
│ └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│        │                │                │                   │
│        └────────────────┼────────────────┘                   │
│                         ▼                                    │
│              ┌─────────────────────┐                        │
│              │   CacheService      │                        │
│              │   (Renderer)        │                        │
│              └──────────┬──────────┘                        │
└─────────────────────────┼────────────────────────────────────┘
                          │ IPC (shared/persist only)
┌─────────────────────────┼────────────────────────────────────┐
│ Main Process            ▼                                    │
│              ┌─────────────────────┐                        │
│              │   CacheService      │                        │
│              │   (Main)            │                        │
│              └─────────────────────┘                        │
│              - Source of truth for shared/persist           │
│              - Broadcasts updates to all windows            │
└──────────────────────────────────────────────────────────────┘
```

## Main vs Renderer Responsibilities

### Main Process CacheService
- Manages internal cache for Main process services
- Maintains authoritative SharedCache with type-safe access (`getShared`, `setShared`, `hasShared`, `deleteShared`)
- Provides `getAllShared()` for new window initialization sync
- Handles IPC requests from renderers and broadcasts updates to all windows
- Manages TTL expiration using absolute timestamps (`expireAt`) for precise cross-window sync

### Renderer Process CacheService
- Manages local memory cache and SharedCache local copy
- Syncs SharedCache from Main on window initialization (async, non-blocking)
- Provides ready state tracking via `isSharedCacheReady()` and `onSharedCacheReady()`
- Broadcasts cache updates to Main for cross-window sync
- Handles hook subscriptions and updates
- Local TTL management for memory cache

## Usage Summary

For detailed code examples and API usage, see [Cache Usage Guide](./cache-usage.md).

| Method | Tier | Type Safety |
|--------|------|-------------|
| `useCache` / `get` / `set` | Memory | Schema-based keys |
| `getCasual` / `setCasual` | Memory | Dynamic keys (manual typing) |
| `useSharedCache` / `getShared` / `setShared` | Shared | Schema-based keys |
| `getSharedCasual` / `setSharedCasual` | Shared | Dynamic keys (manual typing) |
| `usePersistCache` / `getPersist` / `setPersist` | Persist | Schema-based keys only |
