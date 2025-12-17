export type StreamAbortHandler = (reason: unknown) => void

export interface StreamAbortController {
  abortController: AbortController
  registerAbortHandler: (handler: StreamAbortHandler) => void
  clearAbortTimeout: () => void
}

export const STREAM_TIMEOUT_REASON = 'stream timeout'

interface CreateStreamAbortControllerOptions {
  timeoutMs: number
}

export const createStreamAbortController = (options: CreateStreamAbortControllerOptions): StreamAbortController => {
  const { timeoutMs } = options
  const abortController = new AbortController()
  const signal = abortController.signal

  let timeoutId: NodeJS.Timeout | undefined
  let abortHandler: StreamAbortHandler | undefined

  const clearAbortTimeout = () => {
    if (!timeoutId) {
      return
    }
    clearTimeout(timeoutId)
    timeoutId = undefined
  }

  const handleAbort = () => {
    clearAbortTimeout()

    if (!abortHandler) {
      return
    }

    abortHandler(signal.reason)
  }

  signal.addEventListener('abort', handleAbort, { once: true })

  const registerAbortHandler = (handler: StreamAbortHandler) => {
    abortHandler = handler

    if (signal.aborted) {
      abortHandler(signal.reason)
    }
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      if (!signal.aborted) {
        abortController.abort(STREAM_TIMEOUT_REASON)
      }
    }, timeoutMs)
  }

  return {
    abortController,
    registerAbortHandler,
    clearAbortTimeout
  }
}
