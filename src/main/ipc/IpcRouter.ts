import type { RouteDef } from '@shared/ipc/define'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors'
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

  async dispatch(route: string, input: unknown, ctx: IpcContext): Promise<unknown> {
    // Own-property guard: a bare `schemas[route]` resolves inherited members
    // (__proto__, constructor, toString, …) to truthy Object.prototype values, which
    // would slip past a plain truthiness check and surface as an INTERNAL TypeError.
    // Any non-own key is simply an unknown route.
    if (!Object.hasOwn(this.schemas, route)) {
      throw new IpcError(IpcErrorCode.ROUTE_NOT_FOUND, `Unknown IpcApi route: ${route}`)
    }
    const def = this.schemas[route as keyof S]

    const parsed = def.input.safeParse(input)
    if (!parsed.success) {
      throw new IpcError(IpcErrorCode.VALIDATION_FAILED, `Invalid input for ${route}`, { issues: parsed.error.issues })
    }

    const handler = this.handlers[route as keyof S]
    // `parsed.data` is `unknown` here — the generic bound cannot narrow the inferred
    // input type inside the mapped handler signature. Soundness is guaranteed at the
    // constructor boundary by the `IpcHandlersFor<S>` constraint, not at this call.
    return handler(parsed.data as never, ctx)
  }
}
