import { loggerService } from '@logger'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

const logger = loggerService.withContext('streamDispatchCoordinator')

export type StreamDispatchResult =
  | { ok: true; topicId: string; ack: AiStreamOpenResponse }
  | { ok: false; topicId: string; error: Error }

type Listener = (result: StreamDispatchResult) => void

const listeners = new Map<string, Set<Listener>>()

function notify(result: StreamDispatchResult): void {
  const subs = listeners.get(result.topicId)
  if (!subs) return
  for (const cb of [...subs]) {
    try {
      cb(result)
    } catch (err) {
      logger.warn('stream dispatch listener threw', { topicId: result.topicId, err })
    }
  }
}

export const streamDispatchCoordinator = {
  dispatch(topicId: string, request: AiStreamOpenRequest): void {
    window.api.ai
      .streamOpen(request)
      .then((ack) => {
        if (ack.mode === 'blocked' && ack.reason === 'agent-session-workspace') {
          window.toast?.error(ack.message)
        }
        notify({ ok: true, topicId, ack })
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.error('streamOpen IPC failed', err)
        notify({ ok: false, topicId, error: err })
      })
  },

  subscribe(topicId: string, listener: Listener): () => void {
    let subs = listeners.get(topicId)
    if (!subs) {
      subs = new Set()
      listeners.set(topicId, subs)
    }
    subs.add(listener)
    return () => {
      subs.delete(listener)
      if (subs.size === 0) listeners.delete(topicId)
    }
  }
}
