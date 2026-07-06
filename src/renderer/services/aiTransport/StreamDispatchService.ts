import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

const logger = loggerService.withContext('StreamDispatchService')

export type StreamDispatchResult =
  | { ok: true; topicId: string; ack: AiStreamOpenResponse }
  | { ok: false; topicId: string; error: Error }

type Listener = (result: StreamDispatchResult) => void

/**
 * Dispatches `ai.stream_open` requests and fans the resolved ack (or error) out
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

  dispatch(topicId: string, request: AiStreamOpenRequest): void {
    ipcApi
      .request('ai.stream_open', request)
      .then((ack) => {
        if (ack.mode === 'blocked' && ack.reason === 'agent-session-workspace') {
          window.toast?.error(ack.message)
        }
        this.notify({ ok: true, topicId, ack })
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.error('streamOpen IPC failed', err)
        this.notify({ ok: false, topicId, error: err })
      })
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
