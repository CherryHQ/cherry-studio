import { addAbortController } from '@renderer/utils/abortController'

import type { IRequestStateManager, RequestState } from './interfaces'

export class RequestStateManager implements IRequestStateManager {
  private requestStates = new Map<string, RequestState>()
  private signal: AbortSignal | null = null
  isPaused = false
  private readonly onAbort?: (requestId: string) => void

  constructor(onAbort?: (requestId: string) => void) {
    this.onAbort = onAbort
  }

  getRequestState(requestId: string): RequestState {
    let state = this.requestStates.get(requestId)
    if (!state) {
      state = { signal: null, isPaused: false, createdAt: Date.now() }
      this.requestStates.set(requestId, state)
    }
    return state
  }

  createAbortSignal(requestId: string): AbortController {
    const controller = new AbortController()
    this.signal = controller.signal

    const state = this.getRequestState(requestId)
    state.signal = controller.signal

    addAbortController(requestId, () => {
      this.isPaused = true
      state.isPaused = true
      this.signal = null
      this.requestStates.delete(requestId)
      this.onAbort?.(requestId)
      controller.abort()
    })

    return controller
  }

  clearRequestState(requestId: string): void {
    this.requestStates.delete(requestId)
  }

  getSignal(): AbortSignal | null {
    return this.signal
  }
}
