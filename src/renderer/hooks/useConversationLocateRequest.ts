import { useCallback, useEffect, useState } from 'react'

type LocateRequest = {
  conversationId: string
  messageId: string
}

interface UseConversationLocateRequestOptions {
  activeConversationId: string | null | undefined
  visibleConversationId: string | null | undefined
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
  visibleConversationId
}: UseConversationLocateRequestOptions) {
  const [request, setRequest] = useState<LocateRequest>()

  useEffect(() => {
    if (request && request.conversationId !== activeConversationId) {
      setRequest(undefined)
    }
  }, [activeConversationId, request])

  const requestLocate = useCallback((conversationId: string, messageId: string) => {
    setRequest({ conversationId, messageId })
  }, [])
  const clearLocate = useCallback(() => setRequest(undefined), [])
  const locateMessageId =
    request && request.conversationId === activeConversationId && request.conversationId === visibleConversationId
      ? request.messageId
      : undefined

  return { locateMessageId, requestLocate, clearLocate }
}
