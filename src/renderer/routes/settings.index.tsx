import { createFileRoute, redirect } from '@tanstack/react-router'

// /settings/ 重定向到 /settings/general
export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/general' })
  }
})
