import { useTabsContext } from '@renderer/context/TabsContext'

// Re-export types from shared schema
export type { Tab, TabsState, TabType } from '@shared/data/cache/cacheValueTypes'

// Re-export types from context
export type { OpenTabOptions, TabsContextValue } from '@renderer/context/TabsContext'

/**
 * Hook to access tabs state and operations.
 * Must be used within a TabsProvider.
 *
 * This hook provides a shared global state for tabs across all components.
 * Unlike a local useState, calling useTabs() from different components
 * will return the same state reference.
 */
export function useTabs() {
  return useTabsContext()
}
