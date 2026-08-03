import type { SelectionQuoteRequest } from '@renderer/types/selectionQuote'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

class SelectionQuoteService {
  private pendingRequests = new Map<string, SelectionQuoteRequest>()
  // Covers only the gap between opening a Chat tab and its appearance in TabsProvider state.
  private reservedTargetTabId: string | undefined

  store(targetTabId: string, request: SelectionQuoteRequest): void {
    this.pendingRequests.set(targetTabId, request)
  }

  peek(targetTabId: string, requestId: string | undefined): SelectionQuoteRequest | undefined {
    if (!requestId) return undefined

    const request = this.pendingRequests.get(targetTabId)
    return request?.id === requestId ? request : undefined
  }

  ack(targetTabId: string, requestId: string): void {
    if (this.pendingRequests.get(targetTabId)?.id !== requestId) return

    this.pendingRequests.delete(targetTabId)
    if (this.reservedTargetTabId === targetTabId) this.reservedTargetTabId = undefined
  }

  getCurrentRequestId(targetTabId: string): string | undefined {
    return this.pendingRequests.get(targetTabId)?.id
  }

  reserveTargetTab(targetTabId: string): void {
    this.reservedTargetTabId = targetTabId
  }

  getReservedTargetTabId(): string | undefined {
    return this.reservedTargetTabId
  }

  confirmTargetTab(targetTabId: string): void {
    if (this.reservedTargetTabId === targetTabId) this.reservedTargetTabId = undefined
  }

  reconcileTabs(tabs: Tab[]): void {
    const tabIds = new Set(tabs.map((tab) => tab.id))

    if (this.reservedTargetTabId && tabIds.has(this.reservedTargetTabId)) {
      this.reservedTargetTabId = undefined
    }

    for (const targetTabId of this.pendingRequests.keys()) {
      if (targetTabId !== this.reservedTargetTabId && !tabIds.has(targetTabId)) {
        this.pendingRequests.delete(targetTabId)
      }
    }
  }
}

export const selectionQuoteService = new SelectionQuoteService()

function isUsableChatTab(tab: Tab | undefined): tab is Tab {
  if (!tab || tab.type !== 'route') return false
  const url = new URL(tab.url, 'https://www.cherry-ai.com')
  return url.pathname === '/app/chat' && url.searchParams.get('view') !== 'message'
}

export function findSelectionQuoteTargetTab(tabs: Tab[], activeTab: Tab | undefined): Tab | undefined {
  if (isUsableChatTab(activeTab)) return activeTab

  return tabs
    .filter(isUsableChatTab)
    .toSorted((left, right) => (right.lastAccessTime ?? 0) - (left.lastAccessTime ?? 0))[0]
}

type SelectionQuoteNavigation = {
  activeTab: Tab | undefined
  openTab: (url: string, options: { forceNew: true }) => string
  request: SelectionQuoteRequest
  setActiveTab: (id: string) => void
  tabs: Tab[]
  updateTab: (id: string, updates: Partial<Tab>) => void
}

export function routeSelectionQuoteToChat({
  activeTab,
  openTab,
  request,
  setActiveTab,
  tabs,
  updateTab
}: SelectionQuoteNavigation): void {
  const targetTab = findSelectionQuoteTargetTab(tabs, activeTab)
  if (targetTab) {
    selectionQuoteService.confirmTargetTab(targetTab.id)
    selectionQuoteService.store(targetTab.id, request)
    const targetUrl = new URL(targetTab.url, 'https://www.cherry-ai.com')
    targetUrl.searchParams.set('quoteRequestId', request.id)
    updateTab(targetTab.id, { url: `${targetUrl.pathname}${targetUrl.search}` })
    setActiveTab(targetTab.id)
    return
  }

  const reservedTargetTabId = selectionQuoteService.getReservedTargetTabId()
  if (reservedTargetTabId) {
    selectionQuoteService.store(reservedTargetTabId, request)
    setActiveTab(reservedTargetTabId)
    return
  }

  const newTabId = openTab(`/app/chat?quoteRequestId=${encodeURIComponent(request.id)}`, { forceNew: true })
  selectionQuoteService.store(newTabId, request)
  selectionQuoteService.reserveTargetTab(newTabId)
}
