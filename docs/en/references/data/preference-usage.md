# Preference Usage Guide

This guide covers how to use the Preference system in React components and services.

## React Hooks

### usePreference (Single Preference)

```typescript
import { usePreference } from '@data/hooks/usePreference'

// Basic usage - optimistic updates (default)
const [theme, setTheme] = usePreference('app.theme.mode')

// Update the value
await setTheme('dark')

// With pessimistic updates (wait for confirmation)
const [apiKey, setApiKey] = usePreference('api.key', { optimistic: false })
```

### usePreferences (Multiple Preferences)

```typescript
import { usePreferences } from '@data/hooks/usePreference'

// Read multiple preferences at once
const { theme, language, fontSize } = usePreferences([
  'app.theme.mode',
  'app.language',
  'chat.message.font_size'
])
```

## Update Strategies

### Optimistic Updates (Default)

UI updates immediately, then syncs to database. Automatic rollback on failure.

```typescript
const [theme, setTheme] = usePreference('app.theme.mode')

const handleThemeChange = async (newTheme: string) => {
  try {
    await setTheme(newTheme) // UI updates immediately
  } catch (error) {
    // UI automatically rolls back
    console.error('Theme update failed:', error)
  }
}
```

**Best for:**
- Frequent changes (theme, font size)
- Non-critical settings
- Better perceived performance

### Pessimistic Updates

Waits for database confirmation before updating UI.

```typescript
const [apiKey, setApiKey] = usePreference('api.key', { optimistic: false })

const handleApiKeyChange = async (newKey: string) => {
  try {
    await setApiKey(newKey) // Waits for DB confirmation
    toast.success('API key saved')
  } catch (error) {
    toast.error('Failed to save API key')
  }
}
```

**Best for:**
- Security-sensitive settings (API keys, passwords)
- Settings that affect external services
- When confirmation feedback is important

## PreferenceService Direct Usage

For non-React code or batch operations.

### Get Preferences

```typescript
import { preferenceService } from '@data/PreferenceService'

// Get single preference
const theme = await preferenceService.get('app.theme.mode')

// Get multiple preferences
const settings = await preferenceService.getMultiple([
  'app.theme.mode',
  'app.language'
])
// Returns: { 'app.theme.mode': 'dark', 'app.language': 'en' }

// Get with default value
const fontSize = await preferenceService.get('chat.message.font_size') ?? 14
```

### Set Preferences

```typescript
// Set single preference (optimistic by default)
await preferenceService.set('app.theme.mode', 'dark')

// Set with pessimistic update
await preferenceService.set('api.key', 'secret', { optimistic: false })

// Set multiple preferences at once
await preferenceService.setMultiple({
  'app.theme.mode': 'dark',
  'app.language': 'en',
  'chat.message.font_size': 16
})
```

### Subscribe to Changes

```typescript
// Subscribe to preference changes (useful in services)
const unsubscribe = preferenceService.subscribe('app.theme.mode', (newValue) => {
  console.log('Theme changed to:', newValue)
})

// Cleanup when done
unsubscribe()
```

## Common Patterns

### Settings Form

```typescript
function SettingsForm() {
  const [theme, setTheme] = usePreference('app.theme.mode')
  const [language, setLanguage] = usePreference('app.language')
  const [fontSize, setFontSize] = usePreference('chat.message.font_size')

  return (
    <form>
      <select value={theme} onChange={e => setTheme(e.target.value)}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>

      <select value={language} onChange={e => setLanguage(e.target.value)}>
        <option value="en">English</option>
        <option value="zh">中文</option>
      </select>

      <input
        type="number"
        value={fontSize}
        onChange={e => setFontSize(Number(e.target.value))}
        min={12}
        max={24}
      />
    </form>
  )
}
```

### Feature Toggle

```typescript
function ChatMessage({ message }) {
  const [showTimestamp] = usePreference('chat.display.show_timestamp')

  return (
    <div className="message">
      <p>{message.content}</p>
      {showTimestamp && <span className="timestamp">{message.createdAt}</span>}
    </div>
  )
}
```

### Conditional Rendering Based on Settings

```typescript
function App() {
  const [theme] = usePreference('app.theme.mode')
  const [sidebarPosition] = usePreference('app.sidebar.position')

  return (
    <div className={`app theme-${theme}`}>
      {sidebarPosition === 'left' && <Sidebar />}
      <MainContent />
      {sidebarPosition === 'right' && <Sidebar />}
    </div>
  )
}
```

### Batch Settings Update

```typescript
async function resetToDefaults() {
  await preferenceService.setMultiple({
    'app.theme.mode': 'system',
    'app.language': 'en',
    'chat.message.font_size': 14,
    'chat.display.show_timestamp': true
  })
}
```

## Adding New Preference Keys

### 1. Add to Preference Schema

```typescript
// packages/shared/data/preference/preferenceSchemas.ts
export interface PreferenceSchema {
  // Existing keys...
  'myFeature.enabled': boolean
  'myFeature.options': MyFeatureOptions
}
```

### 2. Set Default Value

```typescript
// Same file or separate defaults file
export const preferenceDefaults: Partial<PreferenceSchema> = {
  // Existing defaults...
  'myFeature.enabled': true,
  'myFeature.options': { mode: 'auto', limit: 100 }
}
```

### 3. Use in Code

```typescript
// Now type-safe with auto-completion
const [enabled, setEnabled] = usePreference('myFeature.enabled')
```

## Best Practices

1. **Choose update strategy wisely**: Optimistic for UX, pessimistic for critical settings
2. **Batch related updates**: Use `setMultiple` when changing multiple related settings
3. **Provide sensible defaults**: All preferences should have default values
4. **Keep values atomic**: One preference = one logical setting
5. **Use consistent naming**: Follow `domain.feature.setting` pattern

## Preference vs Other Storage

| Scenario | Use |
|----------|-----|
| User theme preference | `usePreference('app.theme.mode')` |
| Window position | `usePersistCache` (can be lost without impact) |
| API key | `usePreference` with pessimistic updates |
| Search history | `usePersistCache` (nice to have) |
| Conversation history | `DataApiService` (business data) |
