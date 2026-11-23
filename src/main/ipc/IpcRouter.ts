import type * as z from 'zod'

import type { RouteDef } from '@shared/ipc/define'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors/IpcError'
import type { IpcContext, IpcHandlersFor } from '@shared/ipc/types'

/**
 * The IpcApi request router. Far simpler than DataApi's ApiServer: routes are
 * looked up by exact key (O(1), no path-param extraction or method matching).
 *
 * For every request it: looks up the route → parses `input` with the route's zod
 * schema (validation is always on; invalid input becomes a `VALIDATION_FAILED`
 * IpcError) → invokes the handler with the parsed input and the {@link IpcContext}.
 *
 * It deliberately does NOT catch handler errors — the transport layer
 * (`IpcApiService`) normalizes them into a structured result, so the router stays
 * a pure dispatcher.
 */
export class IpcRouter<S extends Record<string, RouteDef>> {
  constructor(
    private readonly schemas: S,
    private readonly handlers: IpcHandlersFor<S>
  ) {}

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Renderer transport input remains untrusted until the selected route's input schema validates it.
  async dispatch(route: string, input: unknown, ctx: IpcContext): Promise<z.infer<S[keyof S]['output']>> {
    // Inherited Object.prototype names are not registered routes.
    if (!Object.hasOwn(this.schemas, route)) {
      throw new IpcError(IpcErrorCode.ROUTE_NOT_FOUND, `Unknown IpcApi route: ${route}`)
    }

    // SAFETY: The constructor's schema map owns the route catalog, and the own-key check rejects unregistered names.
    const key = route as keyof S
    const def = this.schemas[key]

    const parsed = def.input.safeParse(input)

    if (!parsed.success) {
      throw new IpcError(IpcErrorCode.VALIDATION_FAILED, `Invalid input for ${route}`, { issues: parsed.error.issues })
    }

    const handler = this.handlers[key]

    // SAFETY: This key selects both the parsed input schema and its IpcHandlersFor<S> handler; only TS's union call signature requires never.
    return handler(parsed.data as never, ctx)
  }
}
