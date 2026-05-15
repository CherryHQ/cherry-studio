import { createFileRoute, redirect } from '@tanstack/react-router'

// /settings/ 重定向到 /settings/provider
export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/provider' })
  }
})
