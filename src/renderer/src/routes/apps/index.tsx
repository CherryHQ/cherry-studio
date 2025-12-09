import MinAppsPage from '@renderer/pages/minapps/MinAppsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/apps/')({
  component: MinAppsPage
})
