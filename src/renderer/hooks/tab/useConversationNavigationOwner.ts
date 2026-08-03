import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { findConversationTab, getConversationSidebarApp } from '@renderer/utils/conversationNavigation'
import { buildSidebarAppOpenMetadata } from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'
import { useEffect, useRef } from 'react'

import type { TabsContextValue } from './useTabsContext'

const logger = loggerService.withContext('useConversationNavigationOwner')

type ConversationNavigationOwner = Pick<TabsContextValue, 'openTab' | 'setActiveTab'> & {
  tabs: readonly Tab[]
}

interface PendingNavigation {
  requestIds: Set<string>
  target: ConversationNavigationTarget
}

function targetKey(target: ConversationNavigationTarget): string {
  return `${target.conversationType}:${target.conversationId}`
}

function reportOwnership(requestId: string, ownsTarget: boolean): void {
  void ipcApi
    .request('navigation.report_conversation_ownership', { requestId, ownsTarget })
    .catch((error) => logger.warn('Failed to report conversation ownership', { requestId, err: error }))
}

/**
 * Connects one TabsProvider to main's cross-window conversation-navigation coordinator.
 * Ownership is answered on demand from the current render state; no tab mirror or sync effect exists.
 */
export function useConversationNavigationOwner({ tabs, openTab, setActiveTab }: ConversationNavigationOwner): void {
  const pendingNavigationsRef = useRef(new Map<string, PendingNavigation>())

  useIpcOn('navigation.conversation_ownership_requested', ({ requestId, target }) => {
    reportOwnership(requestId, findConversationTab(tabs, target) !== undefined)
  })

  useIpcOn('navigation.conversation_focus_or_open_requested', ({ requestId, target, title }) => {
    const existingTab = findConversationTab(tabs, target)
    if (existingTab) {
      setActiveTab(existingTab.id)
      reportOwnership(requestId, true)
      return
    }

    const key = targetKey(target)
    const pending = pendingNavigationsRef.current.get(key)
    if (pending) {
      pending.requestIds.add(requestId)
      return
    }

    const app = getConversationSidebarApp(target)
    if (!app?.instanceKey) {
      reportOwnership(requestId, false)
      return
    }

    pendingNavigationsRef.current.set(key, { requestIds: new Set([requestId]), target })
    try {
      openTab(app.routePrefix, {
        forceNew: true,
        title,
        metadata: buildSidebarAppOpenMetadata(app, target.conversationId)
      })
    } catch (error) {
      pendingNavigationsRef.current.delete(key)
      logger.warn('Failed to open conversation tab', { requestId, target, err: error })
      reportOwnership(requestId, false)
    }
  })

  useEffect(() => {
    for (const [key, pending] of pendingNavigationsRef.current) {
      const openedTab = findConversationTab(tabs, pending.target)
      if (!openedTab) continue

      pendingNavigationsRef.current.delete(key)
      setActiveTab(openedTab.id)
      for (const requestId of pending.requestIds) reportOwnership(requestId, true)
    }
  }, [setActiveTab, tabs])

  useEffect(
    () => () => {
      for (const pending of pendingNavigationsRef.current.values()) {
        for (const requestId of pending.requestIds) reportOwnership(requestId, false)
      }
      pendingNavigationsRef.current.clear()
    },
    []
  )
}
