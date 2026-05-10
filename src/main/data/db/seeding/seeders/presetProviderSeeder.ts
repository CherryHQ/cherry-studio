import { application } from '@application'
import type { ProtoProviderConfig } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs, ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import type { AuthConfig } from '@shared/data/types/provider'

import type { DbType, ISeeder } from '../../types'

/**
 * Registry entries for vertexai/azure-openai are skeletons (no defaultChatEndpoint,
 * no endpointConfigs) — they need an explicit seed value here.
 *
 * Per the v2 invariant in `ProviderSettings/utils/provider.ts` ("Azure/Vertex/Bedrock
 * reuse other vendors' endpoint protocols, so authType is the only reliable
 * discriminator"), we deliberately do NOT introduce dedicated endpoint types like
 * `azure-openai-chat-completions` / `vertex-generate-content`. Vendor URL routing is
 * driven by `authType` (`iam-azure` → AI SDK `createAzure`, `iam-gcp` → Vertex SDK).
 *
 * `defaultChatEndpoint` here only feeds the reasoning endpoint resolution inside
 * `ProviderRegistryService.mergePresetModel`, i.e. it picks the reasoning format
 * (`openai-chat`, `gemini`, `anthropic`, ...). So the seed must match each
 * provider's wire-format reasoning shape:
 *   - Vertex AI runs Gemini models → `google-generate-content` (gemini thinking)
 *   - Azure OpenAI runs OpenAI models → `openai-chat-completions` (openai effort)
 */
function getSeedDefaultChatEndpoint(providerId: string, presetDefault: ProtoProviderConfig['defaultChatEndpoint']) {
  if (providerId === 'vertexai') {
    return ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
  }

  if (providerId === 'azure-openai') {
    return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  }

  return presetDefault ?? null
}

function getSeedAuthConfig(providerId: string): AuthConfig | null {
  if (providerId === 'vertexai') {
    return { type: 'iam-gcp', project: '', location: '' }
  }

  if (providerId === 'azure-openai') {
    return { type: 'iam-azure', apiVersion: '' }
  }

  if (providerId === 'aws-bedrock') {
    return { type: 'iam-aws', region: '' }
  }

  return null
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
    defaultChatEndpoint: getSeedDefaultChatEndpoint(p.id, p.defaultChatEndpoint),
    authConfig: getSeedAuthConfig(p.id),
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
          authConfig: null,
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
