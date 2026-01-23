import WebSearchGeneralSettings from '@renderer/pages/settings/WebSearchSettings/WebSearchGeneralSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/websearch/general')({
  component: WebSearchGeneralSettings
})
