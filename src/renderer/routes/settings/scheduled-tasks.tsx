import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/scheduled-tasks')({
  component: Outlet
})
