import IntegrationSettings from '@renderer/pages/settings/IntegrationSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/integrations')({
  component: IntegrationSettings
})
