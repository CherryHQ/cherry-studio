import LaunchpadPage from '@renderer/pages/launchpad/LaunchpadPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: LaunchpadPage
})
