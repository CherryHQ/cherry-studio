import { ProviderList } from '@renderer/pages/settings/ProviderSettings'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/provider')({
  component: ProviderList
})
