import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/system')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/general' })
  }
})
