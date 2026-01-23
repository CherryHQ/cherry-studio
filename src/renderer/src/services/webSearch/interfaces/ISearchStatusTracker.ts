import type { WebSearchStatus } from '@renderer/types'

export interface ISearchStatusTracker {
  setStatus(requestId: string, status: WebSearchStatus, delayMs?: number): Promise<void>
  clearStatus(requestId: string): void
}
