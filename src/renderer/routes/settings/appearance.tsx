import { createFileRoute } from '@tanstack/react-router'

import { AppearanceSettings } from '@renderer/pages/settings/AppearanceSettings'

export const Route = createFileRoute('/settings/appearance')({
  component: AppearanceSettings
})
