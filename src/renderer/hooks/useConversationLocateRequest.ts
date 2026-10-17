import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { cacheService } from '@data/CacheService'

type LocateRequest = {
  conversationId: string
  messageId: string | null
}

const navigationLocateKey = (tabId: string) => `navigation.conversation.locate.${tabId}`

export function requestConversationLocate(tabId: string, conversationId: string, messageId: string | null): void {
  cacheService.setCasual<LocateRequest>(navigationLocateKey(tabId), { conversationId, messageId })
}

export function clearConversationLocate(tabId: string): void {
  cacheService.deleteCasual(navigationLocateKey(tabId))
}

interface UseConversationLocateRequestOptions {
  activeConversationId: string | null | undefined
  visibleConversationId: string | null | undefined
  navigationTabId?: string
}

/**
 * Holds a "scroll to message" request bound to one conversation.
 *
 * `locateMessageId` is exposed only while the request's conversation is both the active and the
 * visible one, so neither the previous conversation (still visible while the next one loads) nor
 * the next conversation (reached via a route swap) ever receives another conversation's request.
 * Leaving the active conversation invalidates the request; it does not resume on return.
 *
 * Calling contract: `requestLocate` must run in the same synchronous batch as the switch to its
 * conversation (`setActiveTopic` / `selectSession`). A request made before an awaited switch is
 * invalidated as soon as the still-current active id is observed.
 */
export function useConversationLocateRequest({
  activeConversationId,
  visibleConversationId,
  navigationTabId
}: UseConversationLocateRequestOptions) {
  const [request, setRequest] = useState<LocateRequest>()
  const key = navigationTabId ? navigationLocateKey(navigationTabId) : undefined
  const navigationRequest = useSyncExternalStore(
    useCallback((listener) => (key ? cacheService.subscribe(key, listener) : () => {}), [key]),
    useCallback(() => (key ? cacheService.getCasual<LocateRequest>(key) : undefined), [key])
  )

  useEffect(() => {
    if (request && request.conversationId !== activeConversationId) {
      setRequest(undefined)
    }
  }, [activeConversationId, request])

  useEffect(() => {
    if (key && navigationRequest && navigationRequest.conversationId === activeConversationId) {
      setRequest(navigationRequest)
      cacheService.deleteCasual(key)
    }
  }, [activeConversationId, key, navigationRequest])

  const requestLocate = useCallback((conversationId: string, messageId: string | null) => {
    setRequest({ conversationId, messageId })
  }, [])
  const clearLocate = useCallback(() => setRequest(undefined), [])
  const visibleRequest =
    request?.conversationId === activeConversationId && request?.conversationId === visibleConversationId
      ? request
      : undefined
  const locateMessageId = visibleRequest?.messageId ?? undefined
  const locateToEnd = visibleRequest?.messageId === null

  return { locateMessageId, locateToEnd, requestLocate, clearLocate }
}
