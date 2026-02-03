import MinAppsPage from '@renderer/pages/minapps/MinAppsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/minapp/')({
  component: MinAppsPage
})
