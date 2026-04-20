import { cn } from '@renderer/utils'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo } from 'react'

import { routeTree } from '../../routeTree.gen'

interface PaneRouterProps {
  paneId: string
  url: string
  isActive: boolean
  isPreview?: boolean
  onUrlChange: (paneId: string, url: string) => void
  onFocus: (paneId: string) => void
}

/**
 * PaneRouter - Independent MemoryRouter for each split-view pane.
 *
 * Based on TabRouter but operates at the pane level.
 * Activity visibility is managed by the parent TabContainer.
 */
export const PaneRouter = ({ paneId, url, isActive, isPreview, onUrlChange, onFocus }: PaneRouterProps) => {
  const router = useMemo(() => {
    const history = createMemoryHistory({ initialEntries: [url] })
    return createRouter({ routeTree, history })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  // Sync internal navigation back to pane state
  useEffect(() => {
    return router.subscribe('onResolved', ({ toLocation }) => {
      const nextHref = toLocation.href
      if (nextHref !== url) {
        onUrlChange(paneId, nextHref)
      }
    })
  }, [router, url, onUrlChange, paneId])

  // Navigate when url prop changes externally (e.g., from Sidebar)
  useEffect(() => {
    const currentHref = router.state.location.href
    if (url !== currentHref) {
      void router.navigate({ to: url })
    }
  }, [router, url])

  const handlePointerDown = useCallback(() => {
    if (!isActive) {
      onFocus(paneId)
    }
  }, [isActive, onFocus, paneId])

  return (
    <div
      className={cn(
        'relative h-full w-full transition-colors',
        !isActive && 'bg-muted/20',
        isPreview && 'outline outline-1 outline-dashed outline-primary/40 -outline-offset-1'
      )}
      onPointerDown={handlePointerDown}>
      {isActive && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] bg-primary"
        />
      )}
      <RouterProvider router={router} />
    </div>
  )
}
