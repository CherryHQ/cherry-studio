import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

import { getStreamBlockedMessage } from './getStreamBlockedMessage'

const logger = loggerService.withContext('StreamDispatchService')

export type StreamDispatchResult =
  | { ok: true; topicId: string; ack: AiStreamOpenResponse }
  | { ok: false; topicId: string; error: Error }

type Listener = (result: StreamDispatchResult) => void

/**
 * Dispatches `ai.stream.open` requests and fans the resolved ack (or error) out
 * to the per-topic listeners registered via {@link subscribe}. Owns the listener
 * registry, so it is a stateful singleton capability (naming-conventions §5.2).
 */
class StreamDispatchService {
  private readonly listeners = new Map<string, Set<Listener>>()

  private notify(result: StreamDispatchResult): void {
    const subs = this.listeners.get(result.topicId)
    if (!subs) return
    for (const cb of [...subs]) {
      try {
        cb(result)
      } catch (err) {
        logger.warn('stream dispatch listener threw', { topicId: result.topicId, err })
      }
    }
  }

  async dispatch(topicId: string, request: AiStreamOpenRequest): Promise<StreamDispatchResult> {
    let result: StreamDispatchResult
    try {
      const ack = await ipcApi.request('ai.stream.open', request)
      if (ack.mode === 'blocked') toast.error(getStreamBlockedMessage(ack))
      result = { ok: true, topicId, ack }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('streamOpen IPC failed', err)
      result = { ok: false, topicId, error: err }
    }
    this.notify(result)
    return result
  }

  subscribe(topicId: string, listener: Listener): () => void {
    let subs = this.listeners.get(topicId)
    if (!subs) {
      subs = new Set()
      this.listeners.set(topicId, subs)
    }
    subs.add(listener)
    return () => {
      subs.delete(listener)
      if (subs.size === 0) this.listeners.delete(topicId)
    }
  }
}

export const streamDispatchService = new StreamDispatchService()
