import { usePanes } from './usePanes'

/**
 * Thin convenience hook that surfaces the currently focused leaf pane
 * together with its active tab. Consumers that only need the focused slice
 * can depend on this instead of the whole PanesContext.
 */
export function useActivePane() {
  const { activePane, activeTab, activePaneId } = usePanes()
  return { activePane, activeTab, activePaneId }
}
