import { RELEASE_HISTORY_URL } from '@main/services/AppUpdaterService'
import { resolveCherryCloudApiOrigin } from '@main/services/cherryCloud/CherryCloudService'
import { DIAGNOSTIC_UPLOAD_URL } from '@main/services/diagnostics'
import { REGISTRY_URL_GITCODE, REGISTRY_URL_GITHUB } from '@main/services/ProviderRegistryUpdaterService'
import { getAppEdition } from '@main/utils/appEdition'

export interface NetworkEndpoint {
  readonly id: string
  readonly url: string
  readonly method?: 'HEAD' | 'GET'
}

/**
 * Hosts Cherry Studio itself needs. Each URL is the constant its owning service actually
 * requests, so a domain change there moves the probe with it. The registry mirror follows
 * edition rather than the runtime egress country: listing endpoints must not need the network.
 */
export function builtinEndpoints(): readonly NetworkEndpoint[] {
  return [
    { id: 'update', url: RELEASE_HISTORY_URL },
    { id: 'registry', url: `${getAppEdition() === 'cn' ? REGISTRY_URL_GITCODE : REGISTRY_URL_GITHUB}/manifest.json` },
    { id: 'cloud', url: resolveCherryCloudApiOrigin() },
    { id: 'diagnostics', url: DIAGNOSTIC_UPLOAD_URL }
  ]
}
