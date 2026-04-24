import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/display')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/general' })
  }
})
