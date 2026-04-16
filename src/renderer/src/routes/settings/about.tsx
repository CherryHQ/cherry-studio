import AboutSettings from '@renderer/pages/settings/AboutSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/about')({
  component: AboutSettings
})
