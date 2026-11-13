import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/subscription')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile' })
  }
})
