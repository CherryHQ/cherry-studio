import { vi } from 'vitest'

import type { MessageProjectionUpdate, MessageProjectionView, ProjectionTarget } from '@shared/ai/messageProjection'

/** Drive the real renderer facade/store through the preload boundary. */
export function projectionIpc() {
  const listeners = new Set<(event: unknown) => void>()
  const attachments: Array<{
    target: ProjectionTarget
    subscriptionId: string
    resolve: (view: MessageProjectionView | null) => void
    reject: (error: Error) => void
  }> = []
  const detached: string[] = []
  vi.spyOn(window.api.ipcApi, 'on').mockImplementation((route, listener) => {
    if (route === 'ai.projection.changed') listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  const request = vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    const args = input as { target: ProjectionTarget; subscriptionId: string }
    if (route === 'ai.projection.detach') detached.push(args.subscriptionId)
    if (route !== 'ai.projection.attach') return { ok: true, data: undefined }
    return new Promise((resolve, reject) => {
      attachments.push({ ...args, resolve: (view) => resolve({ ok: true, data: view }), reject })
    })
  })
  return {
    attachments,
    detached,
    request,
    emit(subscriptionId: string, update: MessageProjectionUpdate) {
      for (const listener of listeners) listener({ subscriptionId, update })
    }
  }
}
