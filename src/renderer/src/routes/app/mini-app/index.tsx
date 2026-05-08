import MiniAppsPage from '@renderer/pages/mini-apps/MiniAppsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/mini-app/')({
  component: MiniAppsPage
})
