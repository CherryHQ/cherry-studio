import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type {
  PreferenceUpdateOptions,
  UnifiedPreferenceKeyType,
  UnifiedPreferenceType
} from '@shared/data/preference/preferenceTypes'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

const logger = loggerService.withContext('usePreference')
const DEFAULT_PREFERENCE_OPTIONS: PreferenceUpdateOptions = { optimistic: true }

/**
 * React hook for managing a single preference value with automatic synchronization
 * Uses useSyncExternalStore for optimal React 18 integration and real-time updates
 * Supports both optimistic and pessimistic update strategies for flexible UX
 *
 * @param key - The preference key to manage (must be a valid UnifiedPreferenceKeyType)
 * @param options - Optional configuration for update behavior:
 *   - optimistic: true (default) for immediate UI updates, false for database-first updates
 * @returns A tuple [value, setValue] where:
 *   - value: Current preference value with defaults applied (never undefined)
 *   - setValue: Async function to update the preference value
 *
 * @example
 * ```typescript
 * // Basic usage - managing theme preference with optimistic updates (default)
 * const [theme, setTheme] = usePreference('ui.theme_mode')
 *
 * // Pessimistic updates for critical settings
 * const [webdavPassword, setWebdavPassword] = usePreference('data.backup.webdav.pass', { optimistic: false })
 *
 * // Simple optimistic updates
 * const [fontSize, setFontSize] = usePreference('chat.message.font_size', {
 *   optimistic: true
 * })
 *
 * // Value is never undefined - defaults are applied automatically
 * const handleThemeChange = async (newTheme: string) => {
 *   try {
 *     await setTheme(newTheme) // UI updates immediately with optimistic strategy
 *   } catch (error) {
 *     console.error('Failed to update theme:', error) // Will auto-rollback on failure
 *   }
 * }
 *
 * return (
 *   <select value={theme} onChange={(e) => handleThemeChange(e.target.value)}>
 *     <option value="light">Light</option>
 *     <option value="dark">Dark</option>
 *     <option value="system">System</option>
 *   </select>
 * )
 * ```
 *
 * @example
 * ```typescript
 * // Advanced usage with form handling for message font size
 * const [fontSize, setFontSize] = usePreference('chat.message.font_size', {
 *   optimistic: true // Immediate feedback for UI preferences
 * })
 *
 * const handleFontSizeChange = useCallback(async (size: number) => {
 *   if (size < 8 || size > 72) {
 *     throw new Error('Font size must be between 8 and 72')
 *   }
 *   await setFontSize(size) // Immediate UI update, syncs to database
 * }, [setFontSize])
 *
 * return (
 *   <input
 *     type="number"
 *     value={fontSize}
 *     onChange={(e) => handleFontSizeChange(Number(e.target.value))}
 *     min={8}
 *     max={72}
 *   />
 * )
 * ```
 */
export function usePreference<K extends UnifiedPreferenceKeyType>(
  key: K,
  options: PreferenceUpdateOptions = DEFAULT_PREFERENCE_OPTIONS
): [UnifiedPreferenceType[K], (value: UnifiedPreferenceType[K]) => Promise<void>] {
  // Subscribe to changes for this specific preference (raw value including undefined)
  const rawValue = useSyncExternalStore(
    useCallback((callback) => preferenceService.subscribeChange(key)(callback), [key]),
    useCallback(() => preferenceService.getCachedValue(key), [key]),
    () => undefined // SSR snapshot (not used in Electron context)
  )

  // Load initial value asynchronously if not cached
  useEffect(() => {
    if (rawValue === undefined) {
      preferenceService.get(key).catch((error) => {
        logger.error(`Failed to load initial preference ${key}:`, error as Error)
      })
    }
  }, [key, rawValue])

  // Convert undefined to default value for external consumption
  const exposedValue = rawValue !== undefined ? rawValue : getDefaultValue(key)

  // Memoized setter function
  const setValue = useCallback(
    async (newValue: UnifiedPreferenceType[K]) => {
      try {
        await preferenceService.set(key, newValue, options)
      } catch (error) {
        logger.error(`Failed to set preference ${key}:`, error as Error)
        throw error
      }
    },
    [key, options]
  )

  return [exposedValue, setValue]
}

/**
 * React hook for managing multiple preference values with efficient batch operations
 * Automatically synchronizes all specified preferences and provides type-safe access
 * Supports both optimistic and pessimistic update strategies for flexible UX
 *
 * @param keys - Object mapping local names to preference keys. Keys are your custom names,
 *               values must be valid UnifiedPreferenceKeyType identifiers
 * @param options - Optional configuration for update behavior:
 *   - optimistic: true (default) for immediate UI updates, false for database-first updates
 * @returns A tuple [values, updateValues] where:
 *   - values: Object with your local keys mapped to current preference values with defaults applied
 *   - updateValues: Async function to batch update multiple preferences at once
 *
 * @example
 * ```typescript
 * // Basic usage - managing related UI preferences with optimistic updates
 * const [uiSettings, setUISettings] = useMultiplePreferences({
 *   theme: 'ui.theme_mode',
 *   fontSize: 'chat.message.font_size',
 *   showLineNumbers: 'chat.code.show_line_numbers'
 * })
 *
 * // Pessimistic updates for critical settings
 * const [webdavSettings, setWebdavSettings] = useMultiplePreferences({
 *   password: 'data.backup.webdav.pass',
 *   host: 'data.backup.webdav.host'
 * }, { optimistic: false })
 *
 * // Accessing individual values with type safety (defaults applied automatically)
 * const currentTheme = uiSettings.theme // ThemeMode (never undefined)
 * const currentFontSize = uiSettings.fontSize // number (never undefined)
 * const showLines = uiSettings.showLineNumbers // boolean (never undefined)
 *
 * // Batch updating multiple preferences
 * const resetToDefaults = async () => {
 *   await setUISettings({
 *     theme: 'light',
 *     fontSize: 14,
 *     showLineNumbers: true
 *   })
 * }
 *
 * // Partial updates (only specified keys will be updated)
 * const toggleTheme = async () => {
 *   await setUISettings({
 *     theme: currentTheme === 'light' ? 'dark' : 'light'
 *   })
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Advanced usage - backup settings form with validation
 * const [settings, updateSettings] = useMultiplePreferences({
 *   autoSync: 'data.backup.local.auto_sync',
 *   backupDir: 'data.backup.local.dir',
 *   maxBackups: 'data.backup.local.max_backups',
 *   syncInterval: 'data.backup.local.sync_interval'
 * })
 *
 * // Form submission with error handling
 * const handleSubmit = async (formData: Partial<typeof settings>) => {
 *   try {
 *     // Validate before saving
 *     if (formData.maxBackups && formData.maxBackups < 0) {
 *       throw new Error('Max backups must be non-negative')
 *     }
 *
 *     await updateSettings(formData)
 *     showSuccessMessage('Backup settings saved successfully')
 *   } catch (error) {
 *     showErrorMessage(`Failed to save settings: ${error.message}`)
 *   }
 * }
 *
 * // No need to check for undefined - defaults are applied automatically
 * return (
 *   <form onSubmit={(e) => {
 *     e.preventDefault()
 *     handleSubmit({
 *       maxBackups: parseInt(e.target.maxBackups.value),
 *       syncInterval: parseInt(e.target.syncInterval.value)
 *     })
 *   }}>
 *     <input
 *       name="maxBackups"
 *       type="number"
 *       defaultValue={settings.maxBackups}
 *       min="0"
 *     />
 *     <input
 *       name="syncInterval"
 *       type="number"
 *       defaultValue={settings.syncInterval}
 *       min="60"
 *     />
 *     <button type="submit">Save Backup Settings</button>
 *   </form>
 * )
 * ```
 *
 * @example
 * ```typescript
 * // Performance optimization - grouping related chat code preferences
 * const [codePrefs] = useMultiplePreferences({
 *   showLineNumbers: 'chat.code.show_line_numbers',
 *   wrappable: 'chat.code.wrappable',
 *   collapsible: 'chat.code.collapsible',
 *   autocompletion: 'chat.code.editor.autocompletion',
 *   foldGutter: 'chat.code.editor.fold_gutter'
 * })
 *
 * // Single subscription handles all code preferences
 * // More efficient than 5 separate usePreference calls
 * // No need for null checks - defaults are already applied
 * const codeConfig = useMemo(() => ({
 *   showLineNumbers: codePrefs.showLineNumbers,
 *   wrappable: codePrefs.wrappable,
 *   collapsible: codePrefs.collapsible,
 *   autocompletion: codePrefs.autocompletion,
 *   foldGutter: codePrefs.foldGutter
 * }), [codePrefs])
 *
 * return <CodeBlock config={codeConfig} />
 * ```
 */
export function useMultiplePreferences<T extends Record<string, UnifiedPreferenceKeyType>>(
  keys: T,
  options: PreferenceUpdateOptions = DEFAULT_PREFERENCE_OPTIONS
): [
  { [P in keyof T]: UnifiedPreferenceType[T[P]] },
  (updates: Partial<{ [P in keyof T]: UnifiedPreferenceType[T[P]] }>) => Promise<void>
] {
  const keysDep = JSON.stringify(
    Object.keys(keys)
      .sort()
      .map((localKey) => [localKey, keys[localKey]])
  )
  const stableKeys = useMemo<T>(
    () => ({ ...keys }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keysDep is the semantic identity of `keys`
    [keysDep]
  )
  const keyEntries = useMemo(() => Object.entries(stableKeys), [stableKeys])
  const keyList = useMemo(() => keyEntries.map(([, key]) => key), [keyEntries])

  // Cache the last snapshot to avoid infinite loops
  const lastSnapshotRef = useRef<Record<string, any>>({})

  const rawValues = useSyncExternalStore(
    useCallback(
      (callback: () => void) => {
        // Subscribe to all keys and aggregate the unsubscribe functions
        const unsubscribeFunctions = keyList.map((key) => preferenceService.subscribeChange(key)(callback))

        return () => {
          unsubscribeFunctions.forEach((unsubscribe) => unsubscribe())
        }
      },
      [keyList]
    ),

    useCallback(() => {
      // Check if any values have actually changed
      let hasChanged = Object.keys(lastSnapshotRef.current).length !== keyEntries.length
      const newSnapshot: Record<string, any> = {}

      for (const [localKey, prefKey] of keyEntries) {
        const currentValue = preferenceService.getCachedValue(prefKey)
        newSnapshot[localKey] = currentValue

        if (
          !hasChanged &&
          (!Object.hasOwn(lastSnapshotRef.current, localKey) || lastSnapshotRef.current[localKey] !== currentValue)
        ) {
          hasChanged = true
        }
      }

      // Only create new object if data actually changed
      if (hasChanged) {
        lastSnapshotRef.current = newSnapshot
      }

      return lastSnapshotRef.current
    }, [keyEntries]),

    () => ({}) // No SSR snapshot
  )

  // Load initial values asynchronously if not cached
  useEffect(() => {
    const uncachedKeys = keyEntries
      .filter(([localKey, key]) => rawValues[localKey] === undefined && !preferenceService.isCached(key))
      .map(([, key]) => key)

    if (uncachedKeys.length > 0) {
      preferenceService.getMultipleRaw(uncachedKeys).catch((error) => {
        logger.error('Failed to load initial preferences:', error as Error)
      })
    }
  }, [keyEntries, rawValues])

  // Convert raw values (including undefined) to exposed values (with defaults)
  const exposedValues = useMemo(() => {
    const result: Record<string, any> = {}
    for (const [localKey, prefKey] of keyEntries) {
      const rawValue = rawValues[localKey]
      result[localKey] = rawValue !== undefined ? rawValue : getDefaultValue(prefKey)
    }
    return result
  }, [keyEntries, rawValues])

  // Memoized batch update function
  const updateValues = useCallback(
    async (updates: Partial<{ [P in keyof T]: UnifiedPreferenceType[T[P]] }>) => {
      try {
        // Convert local keys back to preference keys
        const prefUpdates: Record<string, any> = {}
        for (const [localKey, value] of Object.entries(updates)) {
          const prefKey = stableKeys[localKey as keyof T]
          if (prefKey) {
            prefUpdates[prefKey] = value
          }
        }

        await preferenceService.setMultiple(prefUpdates, options)
      } catch (error) {
        logger.error('Failed to update preferences:', error as Error)
        throw error
      }
    },
    [stableKeys, options]
  )

  // Type-cast the values to the expected shape
  const typedValues = exposedValues as { [P in keyof T]: UnifiedPreferenceType[T[P]] }

  return [typedValues, updateValues]
}
