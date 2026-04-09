import type { ProtoProviderConfig, RegistryEndpointConfig } from '@cherrystudio/provider-registry'
import type { EndpointType } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { readProviderRegistry } from '@cherrystudio/provider-registry/node'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { application } from '@main/core/application'
import type { EndpointConfig } from '@shared/data/types/provider'

import type { DbType, ISeed } from '../types'

/**
 * Convert registry endpointConfigs (with reasoningFormat discriminated union)
 * to runtime endpointConfigs (with reasoningFormatType string).
 */
function buildRuntimeEndpointConfigs(
  registryConfigs: Record<string, RegistryEndpointConfig> | undefined
): Partial<Record<EndpointType, EndpointConfig>> | null {
  if (!registryConfigs || Object.keys(registryConfigs).length === 0) return null

  const configs: Partial<Record<EndpointType, EndpointConfig>> = {}

  for (const [k, regConfig] of Object.entries(registryConfigs)) {
    const ep = k as EndpointType
    const config: EndpointConfig = {}

    if (regConfig.baseUrl) config.baseUrl = regConfig.baseUrl
    if (regConfig.modelsApiUrls) config.modelsApiUrls = regConfig.modelsApiUrls
    if (regConfig.reasoningFormat?.type) config.reasoningFormatType = regConfig.reasoningFormat.type

    if (Object.keys(config).length > 0) configs[ep] = config
  }

  return Object.keys(configs).length > 0 ? configs : null
}

function toDbRow(p: ProtoProviderConfig) {
  const apiFeatures = p.apiFeatures
    ? {
        arrayContent: p.apiFeatures.arrayContent,
        streamOptions: p.apiFeatures.streamOptions,
        developerRole: p.apiFeatures.developerRole,
        serviceTier: p.apiFeatures.serviceTier,
        verbosity: p.apiFeatures.verbosity,
        enableThinking: p.apiFeatures.enableThinking
      }
    : null

  return {
    providerId: p.id,
    presetProviderId: p.id,
    name: p.name,
    endpointConfigs: buildRuntimeEndpointConfigs(p.endpointConfigs),
    defaultChatEndpoint: p.defaultChatEndpoint ?? null,
    apiFeatures
  }
}

class PresetProviderSeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    const filePath = application.getPath('feature.provider_registry.data', 'providers.json')
    const { providers: rawProviders } = readProviderRegistry(filePath)

    if (rawProviders.length === 0) return

    const existing = await db.select({ providerId: userProviderTable.providerId }).from(userProviderTable)
    const existingIds = new Set(existing.map((r) => r.providerId))

    const newRows = rawProviders.filter((p) => !existingIds.has(p.id)).map(toDbRow)

    // Always seed cherryai if not present
    if (!existingIds.has('cherryai')) {
      newRows.push({
        providerId: 'cherryai',
        presetProviderId: 'cherryai',
        name: 'CherryAI',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api.cherry-ai.com'
          }
        },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiFeatures: null
      })
    }

    if (newRows.length > 0) {
      await db.insert(userProviderTable).values(newRows)
    }
  }
}

export default PresetProviderSeed
