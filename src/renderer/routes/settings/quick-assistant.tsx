import { createFileRoute } from '@tanstack/react-router'

import QuickAssistantSettings from '@renderer/pages/settings/QuickAssistantSettings'

export const Route = createFileRoute('/settings/quick-assistant')({
  component: QuickAssistantSettings
})
