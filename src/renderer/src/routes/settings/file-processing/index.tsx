import { createFileRoute, redirect } from '@tanstack/react-router'

// /settings/file-processing/ redirects to /settings/file-processing/general
export const Route = createFileRoute('/settings/file-processing/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/file-processing/general' })
  }
})
