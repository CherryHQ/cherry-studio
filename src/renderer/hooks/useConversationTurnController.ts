import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { getStreamBlockedMessage } from '@renderer/services/aiTransport'
import { toast } from '@renderer/services/toast'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

const logger = loggerService.withContext('useConversationTurnController')

export type ConversationTurnPhase = 'draft' | 'persisting' | 'opening' | 'streaming' | 'ready'

export interface UseConversationTurnControllerOptions<TInput, TConversation> {
  scopeKey: string
  onRollback: () => Promise<unknown> | unknown
  ensureConversation: (input: TInput) => Promise<TConversation | null> | TConversation | null
  buildStreamRequest: (input: TInput, conversation: TConversation) => AiStreamOpenRequest
  openStream?: (request: AiStreamOpenRequest, input: TInput) => Promise<AiStreamOpenResponse>
  refreshMetadata?: (conversation: TConversation, ack: AiStreamOpenResponse) => Promise<unknown> | unknown
  onAccepted?: (ack: Exclude<AiStreamOpenResponse, { mode: 'blocked' }>, input: TInput) => Promise<void> | void
  onError?: (error: unknown, input: TInput) => void
}

export function useConversationTurnController<TInput, TConversation>({
  scopeKey,
  onRollback,
  ensureConversation,
  buildStreamRequest,
  openStream,
  refreshMetadata,
  onAccepted,
  onError
}: UseConversationTurnControllerOptions<TInput, TConversation>) {
  const [phase, setPhase] = useState<ConversationTurnPhase>('draft')
  const scopeEpochRef = useRef(0)
  const callbacksRef = useRef({ onAccepted, onError })
  callbacksRef.current = { onAccepted, onError }

  useLayoutEffect(() => {
    scopeEpochRef.current += 1
  }, [scopeKey])

  useEffect(() => {
    setPhase('draft')
  }, [scopeKey])

  const send = useCallback(
    async (input: TInput, options: { throwOnError?: boolean } = {}): Promise<boolean> => {
      const callbacks = callbacksRef.current
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
        const request = buildStreamRequest(input, conversation)
        const ack = await (openStream ? openStream(request, input) : ipcApi.request('ai.stream.open', request))
        // The captured conversation may have committed even if the user switched scopes while
        // Main was opening the stream. Its metadata cache still must converge; only scope-owned
        // adapter/phase/toast state is suppressed below.
        void Promise.resolve(refreshMetadata?.(conversation, ack)).catch((err) => {
          logger.warn('Failed to refresh conversation metadata after stream open', err as Error)
        })
        if (!isCurrentScope()) return ack.mode !== 'blocked'

        if (ack.mode === 'blocked') {
          setPhase('ready')
          const message = getStreamBlockedMessage(ack)
          if (options.throwOnError) return Promise.reject(new Error(message))
          toast.error(message)
          return false
        }

        await callbacks.onAccepted?.(ack, input)
        if (isCurrentScope()) setPhase('streaming')
        return true
      } catch (err) {
        if (!isCurrentScope()) return false
        try {
          await onRollback()
        } catch (rollbackErr) {
          logger.warn('Failed to rollback conversation history after stream open failure', rollbackErr as Error)
        }
        if (!isCurrentScope()) return false
        setPhase('draft')
        if (options.throwOnError) throw err
        if (callbacks.onError) {
          callbacks.onError(err, input)
          return false
        }
        throw err
      }
    },
    [buildStreamRequest, ensureConversation, onRollback, openStream, refreshMetadata]
  )

  return {
    phase,
    layout: phase === 'draft' ? ('draft' as const) : ('docked' as const),
    send
  }
}
