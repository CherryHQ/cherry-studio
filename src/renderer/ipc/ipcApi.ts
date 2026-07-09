import { unwrapIpcResult } from '@shared/ipc/errors/unwrapIpcResult'
import type { IpcEventName, IpcRoute } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload, InputFor, OutputFor } from '@shared/ipc/types'

/**
 * Typed renderer facade over the low-level `window.api.ipcApi` bridge — the IpcApi
 * counterpart of `dataApiService`. Key-style calls mirror `useQuery`/`usePreference`.
 *
 * Only `import type` is used for the schema/route types, so zod never enters the
 * renderer bundle. The shared unwrap helper is plain TS with no zod dependency,
 * so reconstructing errors here is bundle-safe.
 *
 * Independent of `dataApiService`: commands default to NO retry (retrying a
 * side-effecting command is dangerous).
 */
export const ipcApi = {
  /**
   * Invoke a request route. `route` is checked against IpcRoute (IDE completion,
   * compile error on a bad route); input/output types follow from it. Routes whose
   * input is `void` take no second argument (variadic conditional tuple).
   */
  request: <R extends IpcRoute>(
    route: R,
    ...args: InputFor<R> extends void ? [] : [input: InputFor<R>]
  ): Promise<OutputFor<R>> => unwrapIpcResult<OutputFor<R>>(window.api.ipcApi.request(route, args[0])),

  /** Imperative event subscription (any context); returns an unsubscribe function. */
  on: <E extends IpcEventName>(event: E, callback: (payload: EventPayload<E>) => void): (() => void) =>
    window.api.ipcApi.on(event, callback as (payload: unknown) => void)
}
