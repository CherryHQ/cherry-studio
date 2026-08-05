import type { TabRouterContext } from '@renderer/types/router'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

export const Route = createRootRouteWithContext<TabRouterContext>()({
  component: () => <Outlet />
})
