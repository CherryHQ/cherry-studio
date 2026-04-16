import WebSearchProviderSettings from '@renderer/pages/settings/WebSearchSettings/WebSearchProviderSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/websearch/provider/$providerId')({
  component: WebSearchProviderSettings
})
