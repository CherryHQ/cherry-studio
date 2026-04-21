import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@cherrystudio/ui'
import { useCallback } from 'react'

import type { PaneLayout, PaneSplitNode } from '../../hooks/usePanes'
import { usePanesActions } from '../../hooks/usePanes'
import { LeafPaneView } from './LeafPaneView'

interface SplitNodeViewProps {
  node: PaneSplitNode
  path: number[]
  activePaneId: string
  isDetached?: boolean
}

const FIRST_PANEL_ID = 'first'

/**
 * Renders a split node (horizontal or vertical) via the resizable primitive.
 * Each child is either another split node (recursion) or a LeafPaneView.
 */
export function SplitNodeView({ node, path, activePaneId, isDetached }: SplitNodeViewProps) {
  const { updateSplitRatio } = usePanesActions()

  const handleLayoutChanged = useCallback(
    (newLayout: Record<string, number>) => {
      const firstSize = newLayout[FIRST_PANEL_ID]
      if (firstSize !== undefined && Math.abs(firstSize - node.ratio) > 0.5) {
        updateSplitRatio(path, firstSize)
      }
    },
    [updateSplitRatio, path, node.ratio]
  )

  return (
    <ResizablePanelGroup orientation={node.direction} onLayoutChanged={handleLayoutChanged}>
      <ResizablePanel id={FIRST_PANEL_ID} defaultSize={`${node.ratio}%`} minSize="15%">
        <ChildSlot child={node.children[0]} path={[...path, 0]} activePaneId={activePaneId} isDetached={isDetached} />
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={`${100 - node.ratio}%`} minSize="15%">
        <ChildSlot child={node.children[1]} path={[...path, 1]} activePaneId={activePaneId} isDetached={isDetached} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

interface ChildSlotProps {
  child: PaneLayout
  path: number[]
  activePaneId: string
  isDetached?: boolean
}

function ChildSlot({ child, path, activePaneId, isDetached }: ChildSlotProps) {
  if (child.type === 'split') {
    return <SplitNodeView node={child} path={path} activePaneId={activePaneId} isDetached={isDetached} />
  }
  return (
    <LeafPaneView
      pane={child}
      isRootLeaf={false}
      isActivePane={child.paneId === activePaneId}
      isDetached={isDetached}
    />
  )
}
