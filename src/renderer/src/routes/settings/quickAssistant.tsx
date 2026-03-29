import QuickAssistantSettings from '@renderer/pages/settings/QuickAssistantSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/quickAssistant')({
  component: QuickAssistantSettings
})
