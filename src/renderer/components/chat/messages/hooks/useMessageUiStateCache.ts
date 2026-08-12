import type { MessageListActions, MessageListState, MessageUiState } from '@renderer/components/chat/messages/types'
import { useCallback, useMemo } from 'react'

import { getCachedMessageUiState, updateCachedMessageUiState } from '../utils/messageUiStateCache'

type MessageUiStateCache = Pick<MessageListState, 'getMessageUiState'> &
  Pick<MessageListActions, 'updateMessageUiState'>

export function useMessageUiStateCache(): MessageUiStateCache {
  const getMessageUiState = useCallback((messageId: string) => getCachedMessageUiState(messageId), [])

  const updateMessageUiState = useCallback((messageId: string, updates: MessageUiState) => {
    updateCachedMessageUiState(messageId, updates)
  }, [])

  return useMemo(
    () => ({
      getMessageUiState,
      updateMessageUiState
    }),
    [getMessageUiState, updateMessageUiState]
  )
}
