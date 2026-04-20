import { usePanes } from '../../hooks/usePanes'
import { LeafPaneView } from './LeafPaneView'
import { SplitNodeView } from './SplitNodeView'

interface PanesContainerProps {
  isDetached?: boolean
}

/**
 * Top-level renderer for the pane tree. Dispatches the root to either a
 * SplitNodeView (recursive) or a LeafPaneView (single pane).
 *
 * When the root is a single leaf, its tab bar acts as the window-wide tab
 * bar (via `isRootLeaf = true`) — this is how we preserve the pre-refactor
 * "global tab bar" behaviour without introducing a separate concept.
 */
export function PanesContainer({ isDetached = false }: PanesContainerProps) {
  const { panes, activePaneId } = usePanes()

  if (panes.root.type === 'split') {
    return <SplitNodeView node={panes.root} path={[]} activePaneId={activePaneId} isDetached={isDetached} />
  }

  return (
    <LeafPaneView
      pane={panes.root}
      isRootLeaf
      isActivePane={panes.root.paneId === activePaneId}
      isDetached={isDetached}
    />
  )
}
