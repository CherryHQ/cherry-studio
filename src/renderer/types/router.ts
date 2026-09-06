import type { routeTree } from '@renderer/routeTree.gen'
import type { createRouter } from '@tanstack/react-router'

/**
 * The app's router type. `TabRouter` annotates its factory with this, so a router built with
 * non-default options fails there rather than drifting from what is registered here.
 *
 * Pass it explicitly — `useSearch<AppRouter>()`. Left to its `RegisteredRouter` default, the
 * type argument re-enters the `Register` -> route tree -> `Route<Register>` cycle, and
 * TypeScript breaks that cycle by falling back to `any` at whichever call sites it reaches
 * mid-resolution: the search type silently degrades with nothing failing to report it.
 */
export type AppRouter = ReturnType<typeof createRouter<typeof routeTree>>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
