import { ProviderSettingsPage } from '@renderer/pages/settings/ProviderSettingsV2'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/provider-v2')({
  component: ProviderSettingsPage
})
