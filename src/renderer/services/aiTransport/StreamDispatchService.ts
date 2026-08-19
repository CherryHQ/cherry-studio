import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { type ConversationRef, conversationRefKey } from '@shared/ai/conversation'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

import { getStreamBlockedMessage } from './getStreamBlockedMessage'

const logger = loggerService.withContext('StreamDispatchService')

export type StreamDispatchResult =
  | { ok: true; conversation: ConversationRef; ack: AiStreamOpenResponse }
  | { ok: false; conversation: ConversationRef; error: Error }

type Listener = (result: StreamDispatchResult) => void

/**
 * Dispatches `ai.stream.open` requests and fans the resolved ack (or error) out
 * to the per-topic listeners registered via {@link subscribe}. Owns the listener
 * registry, so it is a stateful singleton capability (naming-conventions §5.2).
 */
class StreamDispatchService {
  private readonly listeners = new Map<string, Set<Listener>>()

  private notify(result: StreamDispatchResult): void {
    const key = conversationRefKey(result.conversation)
    const subs = this.listeners.get(key)
    if (!subs) return
    for (const cb of [...subs]) {
      try {
        cb(result)
      } catch (err) {
        logger.warn('stream dispatch listener threw', { conversation: result.conversation, err })
      }
    }
  }

  dispatch(request: AiStreamOpenRequest): void {
    ipcApi
      .request('ai.stream.open', request)
      .then((ack) => {
        if (ack.mode === 'blocked') {
          toast.error(getStreamBlockedMessage(ack))
        }
        this.notify({ ok: true, conversation: request.conversation, ack })
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.error('streamOpen IPC failed', err)
        this.notify({ ok: false, conversation: request.conversation, error: err })
      })
  }

  subscribe(conversation: ConversationRef, listener: Listener): () => void {
    const key = conversationRefKey(conversation)
    let subs = this.listeners.get(key)
    if (!subs) {
      subs = new Set()
      this.listeners.set(key, subs)
    }
    subs.add(listener)
    return () => {
      subs.delete(listener)
      if (subs.size === 0) this.listeners.delete(key)
    }
  }
}

export const streamDispatchService = new StreamDispatchService()
