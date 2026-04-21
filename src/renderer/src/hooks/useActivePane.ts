import { usePanesState } from './usePanes'

/**
 * Thin convenience hook that surfaces the currently focused leaf pane
 * together with its active tab. Reads from the state slice so it only
 * re-renders when state changes (not when actions are rebuilt).
 */
export function useActivePane() {
  const { activePane, activeTab, activePaneId } = usePanesState()
  return { activePane, activeTab, activePaneId }
}
