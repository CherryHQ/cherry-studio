import { createFileRoute } from '@tanstack/react-router'

import { ComputerUseSettings } from '@renderer/pages/settings/ComputerUseSettings'

export const Route = createFileRoute('/settings/computer-use')({
  component: ComputerUseSettings
})
