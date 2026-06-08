import StatsSettings from '@renderer/pages/settings/StatsSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/stats')({
  component: StatsSettings
})
