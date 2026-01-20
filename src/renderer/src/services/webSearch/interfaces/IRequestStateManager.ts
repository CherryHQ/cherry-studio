export interface RequestState {
  signal: AbortSignal | null
  isPaused: boolean
  createdAt: number
}

export interface IRequestStateManager {
  getRequestState(requestId: string): RequestState
  createAbortSignal(requestId: string): AbortController
  clearRequestState(requestId: string): void

  // Legacy compatibility
  readonly isPaused: boolean
  getSignal(): AbortSignal | null
}
