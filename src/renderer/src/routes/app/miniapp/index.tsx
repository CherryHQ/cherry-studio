import MiniAppsPage from '@renderer/pages/miniapps/MiniAppsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/miniapp/')({
  component: MiniAppsPage
})
