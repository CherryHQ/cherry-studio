import type * as z from 'zod'

import type { RouteDef } from './define'
import type { IpcEventName, IpcEventSchemas, IpcRequestSchemas, IpcRoute } from './schemas'

/**
 * A WindowManager window UUID. This is the single id concept used across the
 * whole chain: `IpcContext.senderId`, `IpcApiService.send(windowId, …)` and
 * `WindowManager.getWindow(windowId)` all speak the same `WindowId`.
 */
export type WindowId = string

/**
 * The controlled call-site identity handed to a request handler as its second
 * argument. It exposes only the caller window's id — never the raw `WebContents`
 * or `event` — so a handler cannot widen the exposure surface or be tricked by a
 * renderer-supplied window id (which would be a privilege-escalation vector).
 */
export interface IpcContext {
  /**
   * The caller window's WindowId, or `null` when the sender passed the source-trust
   * gate but is **not a managed WindowManager window** — `validateSender` (frame-URL
   * allowlist) and this registry are independent trust sources that are not
   * cross-checked. A side-effecting handler must decide how to treat `null` (refuse,
   * or use a non-window-scoped path) rather than assume a window is present.
   */
  senderId: WindowId | null
}

/**
 * Handler map for a request schema set: exactly one async handler per route,
 * exhaustive (a missing handler is a compile error) and closed (a handler for an
 * undeclared route is a compile error). The input type is the *parsed* zod type;
 * the second argument is the {@link IpcContext}.
 *
 * The `extends Record<string, RouteDef>` bound is required — without it TS cannot
 * prove `S[R]` has `input`/`output` and reports TS2536.
 */
export type IpcHandlersFor<S extends Record<string, RouteDef>> = {
  [R in keyof S]: (input: z.infer<S[R]['input']>, ctx: IpcContext) => Promise<z.infer<S[R]['output']>>
}

/** Parsed input type for a global request route. */
export type InputFor<R extends IpcRoute> = z.infer<IpcRequestSchemas[R]['input']>
/** Output type for a global request route. */
export type OutputFor<R extends IpcRoute> = z.infer<IpcRequestSchemas[R]['output']>
/** Payload type for a global event name. */
export type EventPayload<E extends IpcEventName> = IpcEventSchemas[E]
