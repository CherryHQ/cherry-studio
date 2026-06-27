import AppearanceSettings from '@renderer/pages/settings/AppearanceSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/appearance')({
  component: AppearanceSettings
})
