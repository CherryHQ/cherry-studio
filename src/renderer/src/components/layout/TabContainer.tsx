import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { useCallback } from 'react'
import { Activity } from 'react'

import { useSplitView } from '../../hooks/useSplitView'
import { PaneRouter } from './PaneRouter'
import { SplitContainer } from './SplitContainer'

interface TabContainerProps {
  tab: Tab
  isActive: boolean
  onUrlChange: (url: string) => void
}

/**
 * TabContainer - Decides between single-view and split-view rendering.
 *
 * Without splitLayout: renders a single PaneRouter (backward compatible with TabRouter).
 * With splitLayout: renders a recursive SplitContainer.
 */
export const TabContainer = ({ tab, isActive, onUrlChange }: TabContainerProps) => {
  const { updatePaneUrl, setActivePane, updateRatio } = useSplitView(tab.id)

  const handleUrlChange = useCallback(
    (paneId: string, url: string) => {
      if (tab.splitLayout) {
        updatePaneUrl(paneId, url)
      } else {
        onUrlChange(url)
      }
    },
    [tab.splitLayout, updatePaneUrl, onUrlChange]
  )

  const handleFocus = useCallback(
    (paneId: string) => {
      setActivePane(paneId)
    },
    [setActivePane]
  )

  if (!tab.splitLayout) {
    // Single view mode — backward compatible with existing TabRouter behavior
    return (
      <Activity mode={isActive ? 'visible' : 'hidden'}>
        <div className="h-full w-full">
          <PaneRouter
            paneId={tab.id}
            url={tab.url}
            isActive={true}
            onUrlChange={handleUrlChange}
            onFocus={handleFocus}
          />
        </div>
      </Activity>
    )
  }

  // Split view mode
  const activePaneId = tab.activePaneId ?? tab.id

  return (
    <Activity mode={isActive ? 'visible' : 'hidden'}>
      <div className="h-full w-full">
        <SplitContainer
          layout={tab.splitLayout}
          activePaneId={activePaneId}
          onUrlChange={handleUrlChange}
          onFocus={handleFocus}
          onResize={updateRatio}
        />
      </div>
    </Activity>
  )
}
