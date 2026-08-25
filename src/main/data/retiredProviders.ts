const RETIRED_PROVIDER_IDS = new Set(['cephalon', 'github', 'tokenflux'])

/** Providers whose upstream services are no longer available. */
export function isRetiredProvider(providerId: string | null | undefined, presetProviderId?: string | null): boolean {
  return (
    (providerId != null && RETIRED_PROVIDER_IDS.has(providerId)) ||
    (presetProviderId != null && RETIRED_PROVIDER_IDS.has(presetProviderId))
  )
}
