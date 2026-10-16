import { useEffect, useEffectEvent, useMemo, useRef } from 'react'

import { loggerService } from '@logger'
import { useDataChange } from '@renderer/data/hooks/useDataApi'
import { useTabs } from '@renderer/hooks/tab'
import { useIpcOn, ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter, type TabSelectionPayload } from '@renderer/services/EventService'
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import { debounce } from '@shared/utils/async'

const logger = loggerService.withContext('useTaskDashboardViewing')
const agentApp = getSidebarApp('agents')!
const sessionFromUrl = (url: string) =>
  tabBelongsToApp(agentApp, url) ? agentApp.conversationRoute?.keyFromUrl(url) : undefined

/** Window-scoped review tracking. Tab restoration never emits a selection event. */
export function useTaskDashboardViewing(): void {
  const { activeTab } = useTabs()
  const pending = useRef<TabSelectionPayload | null>(null)
  const viewed = useRef<TabSelectionPayload | null>(null)
  const blurred = useRef(false)

  const review = useEffectEvent((automatic: boolean) => {
    if (!activeTab || activeTab.type !== 'route' || document.hidden || !document.hasFocus()) return
    const selection = automatic ? viewed.current : pending.current
    if (
      !selection ||
      selection.tabId !== activeTab.id ||
      sessionFromUrl(selection.url) !== sessionFromUrl(activeTab.url)
    )
      return
    const sessionId = sessionFromUrl(activeTab.url)
    if (!sessionId) return
    viewed.current = selection
    pending.current = null
    void ipcApi.request('ai.agent.task_dashboard.view_session', { sessionId, automatic }).catch((error) => {
      logger.warn('Failed to review task results in the active session', error)
    })
  })
  // Effect events read the latest active tab without recreating the pending debounce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reviewAutomatic = useMemo(() => debounce(() => review(true), 250, { maxWait: 1000 }), [])
  useDataChange('/agent-task-dashboard', () => reviewAutomatic())

  const reset = () => {
    pending.current = null
    viewed.current = null
    blurred.current = false
    reviewAutomatic.cancel()
  }
  useIpcOn('ai.agent.task_dashboard.attention_reset', reset)

  useEffect(() => {
    return EventEmitter.on(EVENT_NAMES.ACTIVE_TAB_SELECTED, (payload) => {
      pending.current = payload as TabSelectionPayload
      review(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- review is an effect event.
  }, [])

  useEffect(() => {
    review(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- review is an effect event.
  }, [activeTab?.id, activeTab?.url])

  const regainFocus = useEffectEvent(() => {
    if (!blurred.current || !activeTab) return
    blurred.current = false
    pending.current = { tabId: activeTab.id, url: activeTab.url }
    review(false)
  })
  useEffect(() => {
    const onBlur = () => {
      viewed.current = null
      pending.current = null
      blurred.current = true
    }
    const onVisibility = () => {
      if (document.hidden) onBlur()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', regainFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', regainFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      reviewAutomatic.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- regainFocus is an effect event.
  }, [reviewAutomatic])
}
