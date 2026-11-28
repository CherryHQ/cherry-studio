import { CHERRY_CLOUD_PROVIDER_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { AnalyticsModelSource } from '@shared/ipc/schemas/analytics'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

/** Buckets a provider id into an analytics model source; the provider id itself is never reported. */
export function analyticsModelSource(providerId: string): AnalyticsModelSource {
  if (providerId === CHERRYAI_PROVIDER_ID) return 'cherry_free'
  if (providerId === CHERRY_CLOUD_PROVIDER_ID) return 'cherry_cloud'
  if (providerId === SystemProviderIds.cherryin) return 'cherryin'
  return 'own_key'
}

/** Static ids analytics may name (built-in presets, menu ids, provider ids); never user-entered text. */
export const ANALYTICS_PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,119}$/
