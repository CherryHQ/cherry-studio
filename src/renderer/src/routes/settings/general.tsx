import GeneralSettings from '@renderer/pages/settings/GeneralSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/general')({
  component: GeneralSettings
})
