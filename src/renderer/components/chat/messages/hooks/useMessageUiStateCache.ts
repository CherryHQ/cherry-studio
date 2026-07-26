import { cacheService } from '@data/CacheService'
import type { MessageListActions, MessageListState, MessageUiState } from '@renderer/components/chat/messages/types'
import { useCallback, useMemo } from 'react'

type MessageUiStateCache = Pick<MessageListState, 'getMessageUiState'> &
  Pick<MessageListActions, 'updateMessageUiState'>

export function useMessageUiStateCache(): MessageUiStateCache {
  const getMessageUiState = useCallback(
    (messageId: string) => (cacheService.get(`message.ui.${messageId}` as const) || {}) as MessageUiState,
    []
  )

  const updateMessageUiState = useCallback((messageId: string, updates: MessageUiState) => {
    const cacheKey = `message.ui.${messageId}` as const
    const current = cacheService.get(cacheKey) || {}
    cacheService.set(cacheKey, { ...current, ...updates })
  }, [])

  return useMemo(
    () => ({
      getMessageUiState,
      updateMessageUiState
    }),
    [getMessageUiState, updateMessageUiState]
  )
}
