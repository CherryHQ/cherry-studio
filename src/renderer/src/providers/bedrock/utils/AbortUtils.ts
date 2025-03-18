import { addAbortController, removeAbortController } from '@renderer/utils/abortController'

/**
 * Create abort controller
 * Creates an abort controller and registers/unregisters it with the global abort controller registry
 *
 * @param messageId Message ID
 * @param isAddEventListener Whether to add event listener
 * @returns Abort controller, cleanup function, and signal promise
 */
export function createAbortController(
  messageId?: string,
  isAddEventListener?: boolean
): {
  abortController: AbortController
  cleanup: () => void
  signalPromise?: {
    resolve: (value: unknown) => void
    promise: Promise<unknown>
  }
} {
  const abortController = new AbortController()
  const abortFn = () => abortController.abort()

  if (messageId) {
    addAbortController(messageId, abortFn)
  }

  const cleanup = () => {
    if (messageId) {
      signalPromise.resolve?.(undefined)
      removeAbortController(messageId, abortFn)
    }
  }

  const signalPromise: {
    resolve: (value: unknown) => void
    promise: Promise<unknown>
  } = {
    resolve: () => {},
    promise: Promise.resolve()
  }

  if (isAddEventListener) {
    signalPromise.promise = new Promise((resolve) => {
      signalPromise.resolve = resolve
    })
  }

  return { abortController, cleanup, signalPromise }
}
