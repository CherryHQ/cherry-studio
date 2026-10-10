import { createFileRoute } from '@tanstack/react-router'

import { UsageSettings } from '@renderer/pages/settings/UsageSettings'

export const Route = createFileRoute('/settings/usage')({
  component: UsageSettings
})
