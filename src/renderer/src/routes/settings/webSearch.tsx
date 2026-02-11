import WebSearchSettings from '@renderer/pages/settings/WebSearchSettings/WebSearchSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/webSearch')({
  component: WebSearchSettings
})
