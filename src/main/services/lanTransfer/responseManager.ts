import { createTimeout, onAbort as subscribeToAbort } from '@shared/utils/async'

import { getAbortError } from './handlers'
import type { PendingResponse } from './types'

/**
 * Manages pending response handlers for awaiting control messages.
 * Handles timeouts, abort signals, and cleanup.
 */
export class ResponseManager {
  private pendingResponses = new Map<string, PendingResponse>()
  private onTimeout?: () => void

  /**
   * Set a callback to be called when a response times out.
   * Typically used to trigger disconnect on timeout.
   */
  setTimeoutCallback(callback: () => void): void {
    this.onTimeout = callback
  }

  /**
   * Build a composite key for identifying pending responses.
   */
  buildResponseKey(type: string, transferId?: string, chunkIndex?: number): string {
    const parts = [type]
    if (transferId !== undefined) parts.push(transferId)
    if (chunkIndex !== undefined) parts.push(String(chunkIndex))
    return parts.join(':')
  }

  /**
   * Register a response listener with timeout and optional abort signal.
   */
  waitForResponse(
    type: string,
    timeoutMs: number,
    resolve: (payload: unknown) => void,
    reject: (error: Error) => void,
    transferId?: string,
    chunkIndex?: number,
    abortSignal?: AbortSignal
  ): void {
    const responseKey = this.buildResponseKey(type, transferId, chunkIndex)

    // Clear any existing response with the same key
    this.clearPendingResponse(responseKey)

    const timeoutHandle = createTimeout(timeoutMs, () => {
      this.clearPendingResponse(responseKey)
      const error = new Error(`Timeout waiting for ${type}`)
      reject(error)
      this.onTimeout?.()
    })

    const pending: PendingResponse = {
      type,
      transferId,
      chunkIndex,
      resolve,
      reject,
      timeoutHandle
    }

    this.pendingResponses.set(responseKey, pending)
    if (abortSignal) {
      pending.disposeAbort = subscribeToAbort(abortSignal, () => {
        this.clearPendingResponse(responseKey)
        reject(getAbortError(abortSignal, `Aborted while waiting for ${type}`))
      })
    }
  }

  /**
   * Try to resolve a pending response by type and optional identifiers.
   * Returns true if a matching response was found and resolved.
   */
  tryResolve(type: string, payload: unknown, transferId?: string, chunkIndex?: number): boolean {
    const responseKey = this.buildResponseKey(type, transferId, chunkIndex)
    const pendingResponse = this.pendingResponses.get(responseKey)

    if (pendingResponse) {
      const resolver = pendingResponse.resolve
      this.clearPendingResponse(responseKey)
      resolver(payload)
      return true
    }

    return false
  }

  /**
   * Clear a single pending response by key, or all responses if no key provided.
   */
  clearPendingResponse(key?: string): void {
    if (key) {
      const pending = this.pendingResponses.get(key)
      if (pending?.timeoutHandle) {
        pending.timeoutHandle.dispose()
      }
      pending?.disposeAbort?.()
      this.pendingResponses.delete(key)
    } else {
      // Clear all pending responses
      for (const pending of this.pendingResponses.values()) {
        if (pending.timeoutHandle) {
          pending.timeoutHandle.dispose()
        }
        pending.disposeAbort?.()
      }
      this.pendingResponses.clear()
    }
  }

  /**
   * Reject all pending responses with the given error.
   */
  rejectAll(error: Error): void {
    for (const key of Array.from(this.pendingResponses.keys())) {
      const pending = this.pendingResponses.get(key)
      this.clearPendingResponse(key)
      pending?.reject(error)
    }
  }
}
