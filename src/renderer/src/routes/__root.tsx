import NavigationHandler from '@renderer/handler/NavigationHandler'
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <>
      <NavigationHandler />
      <Outlet />
    </>
  )
})
