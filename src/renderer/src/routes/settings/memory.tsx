import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/memory')({
  beforeLoad: () => {
    throw redirect({ to: '/settings' })
  }
})
