import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/code-execution')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/appearance' })
  }
})
