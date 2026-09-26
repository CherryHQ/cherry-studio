import { createFileRoute } from '@tanstack/react-router'

import { HooksSettings } from '@renderer/pages/settings/HooksSettings'

export const Route = createFileRoute('/settings/hooks')({
  component: HooksSettings
})
