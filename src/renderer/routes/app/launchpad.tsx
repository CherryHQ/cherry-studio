import { createFileRoute } from '@tanstack/react-router'

import LaunchpadPage from '@renderer/pages/launchpad/LaunchpadPage'

export const Route = createFileRoute('/app/launchpad')({
  component: LaunchpadPage
})
