import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { getStreamBlockedMessage } from '@renderer/services/aiTransport'
import { toast } from '@renderer/services/toast'
import { ConversationOpenMode } from '@shared/ai/conversation'
import type {
  ActiveNodeDecision,
  AiStreamOpenRequest,
  AiStreamOpenResponse,
  ConversationExecutionProjection
} from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useConversationTurnController')

export enum ConversationTurnControllerPhase {
  Draft = 'draft',
  Persisting = 'persisting',
  Opening = 'opening',
  Streaming = 'streaming',
  Ready = 'ready'
}

export enum ConversationTurnControllerLayout {
  Draft = 'draft',
  Docked = 'docked'
}

export interface ReservedMessageSeedOptions {
  activeExecutions?: readonly ConversationExecutionProjection[]
  activeNodeDecision?: ActiveNodeDecision
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
  const [phase, setPhase] = useState(ConversationTurnControllerPhase.Draft)
  const scopeEpochRef = useRef(0)

  useLayoutEffect(() => {
    scopeEpochRef.current += 1
  }, [scopeKey])

  useEffect(() => {
    setPhase(ConversationTurnControllerPhase.Draft)
  }, [scopeKey])

  const send = useCallback(
    async (input: TInput): Promise<AiStreamOpenResponse | null> => {
      const scopeEpoch = scopeEpochRef.current
      const isCurrentScope = () => scopeEpochRef.current === scopeEpoch
      let conversation: TConversation | null = null
      try {
        setPhase(ConversationTurnControllerPhase.Persisting)
        conversation = await ensureConversation(input)
        if (!conversation) {
          if (isCurrentScope()) setPhase(ConversationTurnControllerPhase.Draft)
          return null
        }

        if (isCurrentScope()) setPhase(ConversationTurnControllerPhase.Opening)
        const ack = await ipcApi.request('ai.stream.open', buildStreamRequest(input, conversation))
        // The captured conversation may have committed even if the user switched scopes while
        // Main was opening the stream. Its metadata cache still must converge; only scope-owned
        // adapter/phase/toast state is suppressed below.
        void Promise.resolve(refreshMetadata?.(conversation, ack)).catch((err) => {
          logger.warn('Failed to refresh conversation metadata after stream open', err as Error)
        })
        if (!isCurrentScope()) return ack

        if (ack.mode === ConversationOpenMode.Blocked) {
          toast.error(getStreamBlockedMessage(ack))
          if (isCurrentScope()) setPhase(ConversationTurnControllerPhase.Ready)
          return ack
        }

        const reservedMessages = ack.reservedMessages ?? []
        if (reservedMessages.length > 0) {
          await historyAdapter.seedReservedMessages(reservedMessages, {
            activeExecutions: ack.mode === ConversationOpenMode.Started ? ack.activeExecutions : undefined,
            activeNodeDecision: ack.mode === ConversationOpenMode.Started ? ack.activeNodeDecision : undefined
          })
        }

        if (isCurrentScope()) setPhase(ConversationTurnControllerPhase.Streaming)
        return ack
      } catch (err) {
        if (isCurrentScope()) {
          try {
            await historyAdapter.rollback()
          } catch (rollbackErr) {
            logger.warn('Failed to rollback conversation history after stream open failure', rollbackErr as Error)
          }
          setPhase(ConversationTurnControllerPhase.Draft)
        }
        throw err
      }
    },
    [buildStreamRequest, ensureConversation, historyAdapter, refreshMetadata]
  )

  return {
    phase,
    layout:
      phase === ConversationTurnControllerPhase.Draft
        ? ConversationTurnControllerLayout.Draft
        : ConversationTurnControllerLayout.Docked,
    send
  }
}
