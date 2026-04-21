import '@renderer/databases'

import { cn } from '@renderer/utils'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { PanesState, PaneTab, TabType } from '@shared/data/cache/cacheValueTypes'
import { useMemo } from 'react'

import { PanesContainer } from '../../components/layout/PanesContainer'
import { PanesProvider } from '../../context/PanesContext'
import { uuid } from '../../utils'

function buildInitialPanesState(): PanesState {
  const params = new URLSearchParams(window.location.search)
  const url = params.get('url') ?? '/'
  const title = params.get('title') ?? getDefaultRouteTitle(url)
  const rawType = params.get('type')
  const type: TabType = rawType === 'route' || rawType === 'webview' ? rawType : 'route'
  const tabId = params.get('tabId') ?? uuid()
  const isPinned = params.get('isPinned') === 'true'

  const initialTab: PaneTab = {
    id: tabId,
    type,
    url,
    title,
    isPinned,
    lastAccessTime: Date.now(),
    isDormant: false
  }

  return {
    root: {
      type: 'leaf',
      paneId: 'pane-root',
      tabs: [initialTab],
      activeTabId: initialTab.id
    },
    activePaneId: 'pane-root'
  }
}

/**
 * Detached window shell.
 *
 * Runs its own ephemeral PanesProvider (no persistence) seeded from URL
 * query params. The tree is always a single leaf with a single tab — split
 * view and multi-tab are main-window-only for now.
 */
export const DetachedAppShell = () => {
  const initialState = useMemo(buildInitialPanesState, [])

  return (
    <PanesProvider ephemeral initialState={initialState}>
      <div className={cn('flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground')}>
        <PanesContainer isDetached />
      </div>
    </PanesProvider>
  )
}
