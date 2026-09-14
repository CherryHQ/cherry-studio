import { createFileRoute } from '@tanstack/react-router'

import { AboutSettings } from '@renderer/pages/settings/AboutSettings'

export const Route = createFileRoute('/settings/about')({
  component: AboutSettings
})
