import { RELEASE_HISTORY_URL } from '@main/services/AppUpdaterService'
import { resolveCherryCloudApiOrigin } from '@main/services/cherryCloud/CherryCloudService'
import { DIAGNOSTIC_UPLOAD_URL } from '@main/services/diagnostics'
import { resolveRegistryBaseUrl } from '@main/services/ProviderRegistryUpdaterService'
import { regionService } from '@main/services/RegionService'
import { getAppEdition } from '@main/utils/appEdition'

import type { NetworkEndpoint } from './types'

/**
 * Hosts Cherry Studio itself needs. Each URL is the constant its owning service actually
 * requests, so a domain change there moves the probe with it. The registry mirror follows the
 * egress country the updater already detected; before any detection it follows the edition,
 * because listing endpoints must not need the network.
 */
export function builtinEndpoints(): readonly NetworkEndpoint[] {
  const country = regionService.getCachedCountry()
  const inCn = country ? country.toLowerCase() === 'cn' : getAppEdition() === 'cn'
  return [
    { id: 'update', url: RELEASE_HISTORY_URL },
    { id: 'registry', url: `${resolveRegistryBaseUrl(inCn)}/manifest.json` },
    { id: 'cloud', url: resolveCherryCloudApiOrigin() },
    { id: 'diagnostics', url: DIAGNOSTIC_UPLOAD_URL }
  ]
}
