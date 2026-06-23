import { loggerService } from '@logger'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useState } from 'react'

const logger = loggerService.withContext('useConversationTurnController')

export type ConversationTurnPhase = 'draft' | 'persisting' | 'opening' | 'streaming' | 'ready'

export interface ConversationHistoryAdapter {
  seedReservedMessages: (messages: CherryUIMessage[]) => Promise<void> | void
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

  useEffect(() => {
    setPhase('draft')
  }, [scopeKey])

  const send = useCallback(
    async (input: TInput): Promise<AiStreamOpenResponse | null> => {
      let conversation: TConversation | null = null
      try {
        setPhase('persisting')
        conversation = await ensureConversation(input)
        if (!conversation) {
          setPhase('draft')
          return null
        }

        setPhase('opening')
        const ack = await window.api.ai.streamOpen(buildStreamRequest(input, conversation))

        if (ack.mode === 'blocked') {
          window.toast?.error(ack.message)
          setPhase('ready')
          void Promise.resolve(refreshMetadata?.(conversation, ack)).catch((err) => {
            logger.warn('Failed to refresh conversation metadata after blocked turn', err as Error)
          })
          return ack
        }

        const reservedMessages = ack.reservedMessages ?? []
        if (reservedMessages.length > 0) {
          await historyAdapter.seedReservedMessages(reservedMessages)
        }

        setPhase('streaming')
        void Promise.resolve(refreshMetadata?.(conversation, ack)).catch((err) => {
          logger.warn('Failed to refresh conversation metadata after stream open', err as Error)
        })
        return ack
      } catch (err) {
        try {
          await historyAdapter.rollback()
        } catch (rollbackErr) {
          logger.warn('Failed to rollback conversation history after stream open failure', rollbackErr as Error)
        }
        setPhase('draft')
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
