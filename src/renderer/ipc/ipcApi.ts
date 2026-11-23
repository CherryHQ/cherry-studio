import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import type { IpcEventName, IpcRoute } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload, InputFor, OutputFor } from '@shared/ipc/types'

/**
 * Typed renderer facade over the low-level `window.api.ipcApi` bridge — the IpcApi
 * counterpart of `dataApiService`. Key-style calls mirror `useQuery`/`usePreference`.
 *
 * Only `import type` is used for the schema/route types, so zod never enters the
 * renderer bundle. `IpcError` is a value import, but it is plain TS with no zod
 * dependency, so reconstructing errors here is bundle-safe.
 *
 * Independent of `dataApiService`: commands default to NO retry (retrying a
 * side-effecting command is dangerous).
 */
async function unwrap(pending: Promise<unknown>): Promise<unknown> {
  const result = await pending

  if (typeof result !== 'object' || result === null || Array.isArray(result) || !('ok' in result)) {
    throw new IpcError(IpcErrorCode.INTERNAL, 'IpcApi returned a malformed result')
  }

  const ok = result.ok

  if (ok === true && 'data' in result) return result.data

  if (ok === false && 'error' in result) {
    const error = result.error

    if (error !== null && typeof error === 'object' && !Array.isArray(error) && 'code' in error && 'message' in error) {
      const code = error.code
      const message = error.message
      const reportingHandled = 'reportingHandled' in error ? error.reportingHandled : undefined

      if (
        typeof code === 'string' &&
        typeof message === 'string' &&
        (reportingHandled === undefined || reportingHandled === true)
      ) {
        const failure = new IpcError(code, message, 'data' in error ? error.data : undefined)

        if (reportingHandled === true) failure.reportingHandled = true
        throw failure
      }
    }
  }

  throw new IpcError(IpcErrorCode.INTERNAL, 'IpcApi returned a malformed result')
}

export const ipcApi = {
  /**
   * Invoke a request route. `route` is checked against IpcRoute (IDE completion,
   * compile error on a bad route); input/output types follow from it. Routes whose
   * input is `void` take no second argument (variadic conditional tuple).
   */
  request: async <R extends IpcRoute>(
    route: R,
    ...args: InputFor<R> extends void ? [] : [input: InputFor<R>]
  ): Promise<OutputFor<R>> => {
    const data = await unwrap(window.api.ipcApi.request(route, args[0]))

    // SAFETY: The requested route selects its statically typed main handler; preload forwards that handler's response payload unchanged.
    return data as OutputFor<R>
  },

  /** Imperative event subscription (any context); returns an unsubscribe function. */
  on: <E extends IpcEventName>(event: E, callback: (payload: EventPayload<E>) => void): (() => void) =>
    // SAFETY: Preload filters by this same event name; main's typed senders own the corresponding payload contract.
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The generic bridge accepts opaque events before registering this event-specific callback.
    window.api.ipcApi.on(event, callback as (payload: unknown) => void)
}
