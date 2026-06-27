import SystemSettings from '@renderer/pages/settings/SystemSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/system')({
  component: SystemSettings
})
