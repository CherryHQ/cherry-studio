# Preference System Overview

The Preference system provides centralized management for user configuration and application settings with cross-window synchronization.

## Purpose

PreferenceService handles data that:
- Is a **user-modifiable setting that affects app behavior**
- Has a **fixed key structure** with stable value types
- Needs to **persist permanently** until explicitly changed
- Should **sync automatically** across all application windows

## Key Characteristics

### Fixed Key Structure
- Predefined keys in the schema (users modify values, not keys)
- Supports 158 configuration items
- Nested key paths supported (e.g., `app.theme.mode`)

### Atomic Values
- Each preference item represents one logical setting
- Values are typically: boolean, string, number, or simple array/object
- Changes are independent (updating one doesn't affect others)

### Cross-Window Synchronization
- Changes automatically broadcast to all windows
- Consistent state across main window, mini window, etc.
- Conflict resolution handled by Main process

## Update Strategies

### Optimistic Updates (Default)
```typescript
// UI updates immediately, then syncs to database
await preferenceService.set('app.theme.mode', 'dark')
```
- Best for: frequent, non-critical settings
- Behavior: Local state updates first, then persists
- Rollback: Automatic revert if persistence fails

### Pessimistic Updates
```typescript
// Waits for database confirmation before updating UI
await preferenceService.set('api.key', 'secret', { optimistic: false })
```
- Best for: critical settings (API keys, security options)
- Behavior: Persists first, then updates local state
- No rollback needed: UI only updates on success

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer Process                                             │
│ ┌─────────────────────────────────────────────────┐         │
│ │ usePreference Hook                               │         │
│ │ - Subscribe to preference changes               │         │
│ │ - Optimistic/pessimistic update support         │         │
│ └──────────────────────┬──────────────────────────┘         │
│                        ▼                                     │
│ ┌─────────────────────────────────────────────────┐         │
│ │ PreferenceService (Renderer)                    │         │
│ │ - Local cache for fast reads                    │         │
│ │ - IPC proxy to Main process                     │         │
│ │ - Subscription management                       │         │
│ └──────────────────────┬──────────────────────────┘         │
└─────────────────────────┼────────────────────────────────────┘
                          │ IPC
┌─────────────────────────┼────────────────────────────────────┐
│ Main Process            ▼                                    │
│ ┌─────────────────────────────────────────────────┐         │
│ │ PreferenceService (Main)                        │         │
│ │ - Full memory cache of all preferences          │         │
│ │ - SQLite persistence via Drizzle ORM            │         │
│ │ - Cross-window broadcast                        │         │
│ └──────────────────────┬──────────────────────────┘         │
│                        ▼                                     │
│ ┌─────────────────────────────────────────────────┐         │
│ │ SQLite Database (preference table)              │         │
│ │ - scope + key structure                         │         │
│ │ - JSON value storage                            │         │
│ └─────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────┘
```

## Main vs Renderer Responsibilities

### Main Process PreferenceService
- **Source of truth** for all preferences
- Full memory cache for fast access
- SQLite persistence via preference table
- Broadcasts changes to all renderer windows
- Handles batch operations and transactions

### Renderer Process PreferenceService
- Local cache for read performance
- Proxies write operations to Main
- Manages React hook subscriptions
- Handles optimistic update rollbacks
- Listens for cross-window updates

## Database Schema

Preferences are stored in the `preference` table:

```typescript
// Simplified schema
{
  scope: string    // e.g., 'default', 'user'
  key: string      // e.g., 'app.theme.mode'
  value: json      // The preference value
  createdAt: number
  updatedAt: number
}
```

## Preference Categories

### Application Settings
- Theme mode, language, font sizes
- Window behavior, startup options

### Feature Toggles
- Show/hide UI elements
- Enable/disable features

### User Customization
- Keyboard shortcuts
- Default values for operations

### Provider Configuration
- AI provider settings
- API endpoints and tokens

## Usage Summary

For detailed code examples and API usage, see [Preference Usage Guide](./preference-usage.md).

| Operation | Hook | Service Method |
|-----------|------|----------------|
| Read single | `usePreference(key)` | `preferenceService.get(key)` |
| Write single | `setPreference(value)` | `preferenceService.set(key, value)` |
| Read multiple | `usePreferences([...keys])` | `preferenceService.getMultiple([...keys])` |
| Write multiple | - | `preferenceService.setMultiple({...})` |
