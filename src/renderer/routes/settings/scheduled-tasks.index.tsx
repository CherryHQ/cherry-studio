import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/scheduled-tasks/')({
  beforeLoad: () => {
    throw redirect({ to: '/app/scheduled-tasks', search: {}, replace: true })
  }
})
