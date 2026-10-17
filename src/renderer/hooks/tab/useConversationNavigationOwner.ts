import { useEffect, useRef } from 'react'

import { loggerService } from '@logger'
import { clearConversationLocate, requestConversationLocate } from '@renderer/hooks/useConversationLocateRequest'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { findConversationTab, getConversationSidebarApp } from '@renderer/utils/conversationNavigation'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

import type { TabsContextValue } from './useTabsContext'

const logger = loggerService.withContext('useConversationNavigationOwner')

type ConversationNavigationOwner = Pick<TabsContextValue, 'openTab' | 'setActiveTab' | 'activeTabId'> & {
  tabs: readonly Tab[]
}

interface PendingNavigation {
  requestIds: Set<string>
  target: ConversationNavigationTarget
  messageId?: string | null
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
export function useConversationNavigationOwner({
  tabs,
  activeTabId,
  openTab,
  setActiveTab
}: ConversationNavigationOwner): void {
  const pendingNavigationsRef = useRef(new Map<string, PendingNavigation>())
  const previousTabIdsRef = useRef(new Set(tabs.map((tab) => tab.id)))

  useIpcOn('navigation.conversation_ownership_requested', ({ requestId, target, activeOnly }) => {
    const candidates = activeOnly ? tabs.filter((tab) => tab.id === activeTabId) : tabs
    reportOwnership(requestId, findConversationTab(candidates, target) !== undefined)
  })

  useIpcOn('navigation.conversation_focus_or_open_requested', ({ requestId, target, title, messageId }) => {
    const existingTab = findConversationTab(tabs, target)
    if (existingTab) {
      if (messageId !== undefined) requestConversationLocate(existingTab.id, target.conversationId, messageId)
      setActiveTab(existingTab.id)
      reportOwnership(requestId, true)
      return
    }

    const key = targetKey(target)
    const pending = pendingNavigationsRef.current.get(key)
    if (pending) {
      pending.requestIds.add(requestId)
      if (messageId !== undefined) pending.messageId = messageId
      return
    }

    const app = getConversationSidebarApp(target)
    if (!app?.conversationRoute) {
      reportOwnership(requestId, false)
      return
    }

    pendingNavigationsRef.current.set(key, { requestIds: new Set([requestId]), target, messageId })
    try {
      openTab(app.conversationRoute.urlForKey(target.conversationId), {
        forceNew: true,
        title
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
      if (pending.messageId !== undefined)
        requestConversationLocate(openedTab.id, pending.target.conversationId, pending.messageId)
      setActiveTab(openedTab.id)
      for (const requestId of pending.requestIds) reportOwnership(requestId, true)
    }
  }, [setActiveTab, tabs])

  useEffect(() => {
    const tabIds = new Set(tabs.map((tab) => tab.id))
    for (const id of previousTabIdsRef.current) {
      if (!tabIds.has(id)) clearConversationLocate(id)
    }
    previousTabIdsRef.current = tabIds
  }, [tabs])

  useEffect(
    () => () => {
      for (const pending of pendingNavigationsRef.current.values()) {
        for (const requestId of pending.requestIds) reportOwnership(requestId, false)
      }
      pendingNavigationsRef.current.clear()
      for (const id of previousTabIdsRef.current) clearConversationLocate(id)
    },
    []
  )
}
