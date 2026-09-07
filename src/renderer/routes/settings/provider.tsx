import { ProviderSettingsPage } from '@renderer/pages/settings/ProviderSettings'
import { createFileRoute } from '@tanstack/react-router'
import * as z from 'zod'

export const providerSettingsSearchSchema = z.object({
  // The deep-link payload is a JSON-object string, but TanStack Router's default
  // parseSearch JSON-parses query values, so this arrives as an object. Accept both
  // and normalize back to the string the downstream consumer (JSON.parse) expects.
  addProviderData: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .transform((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .optional(),
  filter: z.string().optional(),
  id: z.string().optional()
})

export const Route = createFileRoute('/settings/provider')({
  validateSearch: (search) => providerSettingsSearchSchema.parse(search),
  component: ProviderSettingsPage
})
