import { createFileRoute } from '@tanstack/react-router'

import WebSearchSettings from '@renderer/pages/settings/WebSearchSettings/WebSearchSettings'

export const Route = createFileRoute('/settings/websearch')({
  component: WebSearchSettings
})
