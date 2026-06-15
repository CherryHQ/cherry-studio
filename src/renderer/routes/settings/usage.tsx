import UsageSettings from '@renderer/pages/settings/UsageSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/usage')({
  component: UsageSettings
})
