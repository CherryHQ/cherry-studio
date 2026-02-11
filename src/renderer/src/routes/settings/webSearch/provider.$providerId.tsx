import WebSearchProviderSetting from '@renderer/pages/settings/WebSearchSettings/components/ProviderSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/webSearch/provider/$providerId')({
  component: WebSearchProviderSetting
})
