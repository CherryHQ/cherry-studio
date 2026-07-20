import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { miniAppIdFromTabUrl } from '@renderer/utils/miniAppUrl'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'

/**
 * Exits keep-alive mini apps whose tabs were explicitly closed.
 *
 * Trigger and judgment are split on purpose: the tabs-closed notification only
 * says which mini-app tabs the user closed; whether the app actually exits is
 * decided after that close has committed, against the then-current tab set —
 * the same app may still be referenced by another tab (e.g. a pinned duplicate),
 * in which case it stays alive. Navigating a tab away from a mini app rewrites
 * the URL without closing and therefore never fires — that is the "switch away
 * keeps it alive" half of the design.
 *
 * Mounted once per shell, next to MiniAppTabsPool (renders nothing).
 */
const MiniAppTabsCleanup: FC = () => {
  const tabsContext = useOptionalTabsContext()
  const subscribeTabsClosed = tabsContext?.subscribeTabsClosed
  const tabs = tabsContext?.tabs
  const { exitMiniApp } = useMiniApps()
  const pendingExitIdsRef = useRef<Set<string>>(new Set())
  const [checkTick, setCheckTick] = useState(0)

  useEffect(() => {
    if (!subscribeTabsClosed) return
    return subscribeTabsClosed((closedTabs) => {
      let added = false
      for (const tab of closedTabs) {
        const appId = miniAppIdFromTabUrl(tab.url)
        if (appId) {
          pendingExitIdsRef.current.add(appId)
          added = true
        }
      }
      // The notification fires synchronously inside closeTabs, so this state
      // update batches into the same commit as the tab-list updates; the
      // judgment effect below then runs once, against the post-close tab set.
      if (added) setCheckTick((tick) => tick + 1)
    })
  }, [subscribeTabsClosed])

  useEffect(() => {
    if (pendingExitIdsRef.current.size === 0) return
    const pendingIds = [...pendingExitIdsRef.current]
    // Judge each pending id exactly once — on the first commit after its close
    // event — then clear unconditionally. Keeping a still-referenced id around
    // for re-judgment on later tab changes would turn a subsequent navigation
    // away (which must keep the app alive) into an exit.
    pendingExitIdsRef.current.clear()

    const referencedIds = new Set<string>()
    for (const tab of tabs ?? []) {
      const appId = miniAppIdFromTabUrl(tab.url)
      if (appId) referencedIds.add(appId)
    }
    for (const appId of pendingIds) {
      if (!referencedIds.has(appId)) exitMiniApp(appId)
    }
  }, [checkTick, tabs, exitMiniApp])

  return null
}

export default MiniAppTabsCleanup
