import type { ProtoProviderConfig } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs, ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { application } from '@main/core/application'

import type { DbType, ISeed } from '../types'

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
    let rawProviders: ProtoProviderConfig[]
    try {
      const loader = new RegistryLoader({
        models: application.getPath('feature.provider_registry.data', 'models.json'),
        providers: application.getPath('feature.provider_registry.data', 'providers.json'),
        providerModels: application.getPath('feature.provider_registry.data', 'provider-models.json')
      })
      rawProviders = loader.loadProviders()
    } catch (error) {
      throw new Error('PresetProviderSeed: failed to load registry providers', { cause: error })
    }

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
