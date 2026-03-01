import SelectionAssistantSettings from '@renderer/pages/settings/SelectionAssistantSettings/SelectionAssistantSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/selectionAssistant')({
  component: SelectionAssistantSettings
})
