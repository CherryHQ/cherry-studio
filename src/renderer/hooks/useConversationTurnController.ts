import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { getStreamBlockedMessage } from '@renderer/services/aiTransport'
import { toast } from '@renderer/services/toast'
import type { ActiveExecution, AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('useConversationTurnController')

export type ConversationTurnPhase = 'draft' | 'persisting' | 'opening' | 'streaming' | 'ready'

export interface ReservedMessageSeedOptions {
  activeExecutions?: readonly ActiveExecution[]
  preserveActiveNode?: boolean
}

export interface ConversationHistoryAdapter {
  seedReservedMessages: (messages: CherryUIMessage[], options?: ReservedMessageSeedOptions) => Promise<void> | void
  refresh: () => Promise<unknown> | unknown
  rollback: () => Promise<unknown> | unknown
}

export interface UseConversationTurnControllerOptions<TInput, TConversation> {
  scopeKey: string
  historyAdapter: ConversationHistoryAdapter
  ensureConversation: (input: TInput) => Promise<TConversation | null> | TConversation | null
  buildStreamRequest: (input: TInput, conversation: TConversation) => AiStreamOpenRequest
  refreshMetadata?: (conversation: TConversation, ack: AiStreamOpenResponse) => Promise<unknown> | unknown
}

export function useConversationTurnController<TInput, TConversation>({
  scopeKey,
  historyAdapter,
  ensureConversation,
  buildStreamRequest,
  refreshMetadata
}: UseConversationTurnControllerOptions<TInput, TConversation>) {
  const [phase, setPhase] = useState<ConversationTurnPhase>('draft')
  const scopeEpochRef = useRef(0)

  useLayoutEffect(() => {
    scopeEpochRef.current += 1
  }, [scopeKey])

  useEffect(() => {
    setPhase('draft')
  }, [scopeKey])

  const send = useCallback(
    async (input: TInput): Promise<boolean> => {
      const scopeEpoch = scopeEpochRef.current
      const isCurrentScope = () => scopeEpochRef.current === scopeEpoch
      let conversation: TConversation | null = null
      try {
        setPhase('persisting')
        conversation = await ensureConversation(input)
        if (!conversation) {
          if (isCurrentScope()) setPhase('draft')
          return false
        }

        if (isCurrentScope()) setPhase('opening')
        const ack = await ipcApi.request('ai.stream.open', buildStreamRequest(input, conversation))
        // The captured conversation may have committed even if the user switched scopes while
        // Main was opening the stream. Its metadata cache still must converge; only scope-owned
        // adapter/phase/toast state is suppressed below.
        void Promise.resolve(refreshMetadata?.(conversation, ack)).catch((err) => {
          logger.warn('Failed to refresh conversation metadata after stream open', err as Error)
        })
        if (!isCurrentScope()) return ack.mode !== 'blocked'

        if (ack.mode === 'blocked') {
          toast.error(getStreamBlockedMessage(ack))
          if (isCurrentScope()) setPhase('ready')
          return false
        }

        const reservedMessages = ack.reservedMessages ?? []
        if (reservedMessages.length > 0) {
          await historyAdapter.seedReservedMessages(reservedMessages, {
            activeExecutions: ack.activeExecutions,
            preserveActiveNode: ack.preserveActiveNode
          })
        }

        if (isCurrentScope()) setPhase('streaming')
        return true
      } catch (err) {
        if (isCurrentScope()) {
          try {
            await historyAdapter.rollback()
          } catch (rollbackErr) {
            logger.warn('Failed to rollback conversation history after stream open failure', rollbackErr as Error)
          }
          setPhase('draft')
        }
        throw err
      }
    },
    [buildStreamRequest, ensureConversation, historyAdapter, refreshMetadata]
  )

  return {
    phase,
    layout: phase === 'draft' ? ('draft' as const) : ('docked' as const),
    send
  }
}
