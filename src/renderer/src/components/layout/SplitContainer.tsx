import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@cherrystudio/ui'
import type { SplitLayout, SplitNode } from '@shared/data/cache/cacheValueTypes'
import { useCallback } from 'react'

import { PaneRouter } from './PaneRouter'

interface SplitContainerProps {
  layout: SplitLayout
  activePaneId: string
  onUrlChange: (paneId: string, url: string) => void
  onFocus: (paneId: string) => void
  onResize: (path: number[], ratio: number) => void
  path?: number[]
}

const FIRST_PANEL_ID = 'first'

/**
 * SplitNodeContainer - Renders a split node with resizable panels.
 * Separated from SplitContainer to satisfy React hooks rules (no early return before hooks).
 */
const SplitNodeContainer = ({
  layout,
  activePaneId,
  onUrlChange,
  onFocus,
  onResize,
  path = []
}: SplitContainerProps & { layout: SplitNode }) => {
  const handleLayoutChanged = useCallback(
    (newLayout: Record<string, number>) => {
      const firstSize = newLayout[FIRST_PANEL_ID]
      if (firstSize !== undefined && Math.abs(firstSize - layout.ratio) > 0.5) {
        onResize(path, firstSize)
      }
    },
    [onResize, path, layout.ratio]
  )

  return (
    <ResizablePanelGroup orientation={layout.direction} onLayoutChanged={handleLayoutChanged}>
      <ResizablePanel id={FIRST_PANEL_ID} defaultSize={`${layout.ratio}%`} minSize="15%">
        <SplitContainer
          layout={layout.children[0]}
          activePaneId={activePaneId}
          onUrlChange={onUrlChange}
          onFocus={onFocus}
          onResize={onResize}
          path={[...path, 0]}
        />
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={`${100 - layout.ratio}%`} minSize="15%">
        <SplitContainer
          layout={layout.children[1]}
          activePaneId={activePaneId}
          onUrlChange={onUrlChange}
          onFocus={onFocus}
          onResize={onResize}
          path={[...path, 1]}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

/**
 * SplitContainer - Recursively renders a SplitLayout tree.
 *
 * Leaf nodes render PaneRouter; split nodes delegate to SplitNodeContainer.
 */
export const SplitContainer = ({
  layout,
  activePaneId,
  onUrlChange,
  onFocus,
  onResize,
  path = []
}: SplitContainerProps) => {
  if (layout.type === 'leaf') {
    return (
      <PaneRouter
        paneId={layout.paneId}
        url={layout.url}
        isActive={layout.paneId === activePaneId}
        isPreview={layout.isPreview}
        onUrlChange={onUrlChange}
        onFocus={onFocus}
      />
    )
  }

  return (
    <SplitNodeContainer
      layout={layout}
      activePaneId={activePaneId}
      onUrlChange={onUrlChange}
      onFocus={onFocus}
      onResize={onResize}
      path={path}
    />
  )
}
