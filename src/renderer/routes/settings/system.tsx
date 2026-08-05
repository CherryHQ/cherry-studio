import { createFileRoute } from '@tanstack/react-router'

import { SystemSettings } from '@renderer/pages/settings/SystemSettings'

export const Route = createFileRoute('/settings/system')({
  component: SystemSettings
})
