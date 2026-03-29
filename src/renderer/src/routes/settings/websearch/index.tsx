import { createFileRoute, redirect } from '@tanstack/react-router'

// /settings/websearch/ 重定向到 /settings/websearch/general
export const Route = createFileRoute('/settings/websearch/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/websearch/general' })
  }
})
