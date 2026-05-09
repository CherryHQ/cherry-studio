import { ProviderSettingsPage } from '@renderer/pages/settings/ProviderSettingsV2'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

const providerSettingsSearchSchema = z.object({
  addProviderData: z.string().optional(),
  filter: z.string().optional(),
  id: z.string().optional()
})

export const Route = createFileRoute('/settings/provider-v2')({
  validateSearch: (search) => providerSettingsSearchSchema.parse(search),
  component: ProviderSettingsPage
})
