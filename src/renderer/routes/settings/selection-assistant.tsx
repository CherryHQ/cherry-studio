import { createFileRoute } from '@tanstack/react-router'

import SelectionAssistantSettings from '@renderer/pages/settings/SelectionAssistantSettings/SelectionAssistantSettings'

export const Route = createFileRoute('/settings/selection-assistant')({
  component: SelectionAssistantSettings
})
