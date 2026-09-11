import { createFileRoute } from '@tanstack/react-router'

import { GeneralSettings } from '@renderer/pages/settings/GeneralSettings'

export const Route = createFileRoute('/settings/general')({
  component: GeneralSettings
})
