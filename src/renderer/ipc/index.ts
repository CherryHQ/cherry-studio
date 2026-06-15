import { IpcError, IpcErrorCode, type IpcResult } from '@shared/ipc/errors'
import type { IpcEventName, IpcRoute } from '@shared/ipc/schemas'
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
async function unwrap<T>(pending: Promise<unknown>): Promise<T> {
  const result = await pending
  if (typeof result !== 'object' || result === null || !('ok' in result)) {
    // Main always returns an IpcResult; a malformed value means a broken handler
    // registration or transport — surface a typed error, not an opaque TypeError.
    throw new IpcError(IpcErrorCode.INTERNAL, 'IpcApi returned a malformed result')
  }
  const envelope = result as IpcResult<T>
  if (envelope.ok) return envelope.data
  throw IpcError.fromJSON(envelope.error)
}

export const ipcApi = {
  /**
   * Invoke a request route. `route` is checked against IpcRoute (IDE completion,
   * compile error on a bad route); input/output types follow from it. Routes whose
   * input is `void` take no second argument (variadic conditional tuple).
   */
  request: <R extends IpcRoute>(
    route: R,
    ...args: InputFor<R> extends void ? [] : [input: InputFor<R>]
  ): Promise<OutputFor<R>> => unwrap<OutputFor<R>>(window.api.ipcApi.request(route, args[0])),

  /** Imperative event subscription (any context); returns an unsubscribe function. */
  on: <E extends IpcEventName>(event: E, callback: (payload: EventPayload<E>) => void): (() => void) =>
    window.api.ipcApi.on(event, callback as (payload: unknown) => void)
}
