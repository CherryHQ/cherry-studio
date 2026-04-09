import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/agents')({
  beforeLoad: () => {
    throw redirect({ to: '/app/agents' })
  }
})
