import { vi } from 'vitest'

const inFlightQueries = new Map<string, Promise<unknown>>()

function createAbortError(reason: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason
  }

  if (reason instanceof Error) {
    const error = new Error(reason.message)
    error.name = 'AbortError'
    return error
  }

  const error = new Error(typeof reason === 'string' ? reason : 'The operation was aborted')
  error.name = 'AbortError'
  return error
}

function withCallerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError(signal.reason))
  }

  return new Promise<T>((resolve, reject) => {
    const abortHandler = () => reject(createAbortError(signal.reason))

    signal.addEventListener('abort', abortHandler, { once: true })

    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abortHandler)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abortHandler)
        reject(error)
      }
    )
  })
}

export const MockMainDoc2xRuntimeServiceExport = {
  doc2xRuntimeService: {
    runDedupedQuery: vi.fn(
      (providerTaskId: string, runner: (signal: AbortSignal) => Promise<unknown>, callerSignal?: AbortSignal) => {
        const existingQuery = inFlightQueries.get(providerTaskId)

        if (existingQuery) {
          return withCallerAbort(existingQuery, callerSignal)
        }

        const controller = new AbortController()
        const promise = runner(controller.signal).finally(() => {
          if (inFlightQueries.get(providerTaskId) === promise) {
            inFlightQueries.delete(providerTaskId)
          }
        })

        inFlightQueries.set(providerTaskId, promise)
        return withCallerAbort(promise, callerSignal)
      }
    ),
    __reset: vi.fn(() => {
      inFlightQueries.clear()
    })
  }
}
