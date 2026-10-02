import type { ProviderEdition } from '@cherrystudio/provider-registry'

export const APP_EDITIONS = ['global', 'cn'] as const satisfies readonly ProviderEdition[]

export type AppEdition = (typeof APP_EDITIONS)[number]
