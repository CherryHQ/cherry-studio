import WebSearchSettings from '@renderer/pages/settings/WebSearchSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/websearch')({
  component: WebSearchSettings
})
