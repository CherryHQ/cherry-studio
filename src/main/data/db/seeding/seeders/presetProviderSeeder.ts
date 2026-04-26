import { application } from '@application'
import type { ProtoProviderConfig } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs, ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'

import type { DbType, ISeeder } from '../../types'

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

export class PresetProviderSeeder implements ISeeder {
  readonly name = 'presetProvider'
  readonly description = 'Insert preset provider configurations'

  private _loader?: RegistryLoader

  private getLoader(): RegistryLoader {
    if (!this._loader) {
      this._loader = new RegistryLoader({
        models: application.getPath('feature.provider_registry.data', 'models.json'),
        providers: application.getPath('feature.provider_registry.data', 'providers.json'),
        providerModels: application.getPath('feature.provider_registry.data', 'provider-models.json')
      })
    }
    return this._loader
  }

  get version(): string {
    return this.getLoader().getProvidersVersion()
  }

  async run(db: DbType): Promise<void> {
    let rawProviders: ProtoProviderConfig[]
    try {
      rawProviders = this.getLoader().loadProviders()
    } catch (error) {
      throw new Error('PresetProviderSeeder: failed to load registry providers', { cause: error })
    }

    if (rawProviders.length === 0) return

    await db.transaction(async (tx) => {
      const existing = await tx.select({ providerId: userProviderTable.providerId }).from(userProviderTable)
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
        await insertManyWithOrderKey(tx, userProviderTable, newRows, {
          pkColumn: userProviderTable.providerId
        })
      }
    })
  }
}
