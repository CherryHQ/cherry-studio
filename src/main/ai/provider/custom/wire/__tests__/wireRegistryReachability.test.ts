import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { EndpointType } from '@shared/data/types/model'
import type { AuthConfig } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../../../__tests__/fixtures/model'
import { makeProvider } from '../../../../__tests__/fixtures/provider'
import { resolveImageTransport } from '../../imageTransportRegistry'
import { WIRE_REGISTRY } from '../wireProfile'

/**
 * A `WIRE_REGISTRY` row is consulted on the **SDK delivery branch only**
 * (`AiService.generateImage` picks the transport branch first). So a row whose
 * provider can never arrive at that branch under its own id is dead code that still
 * reads like a live declaration — and the two halves disagree about the vendor bag's
 * vocabulary (the SDK body is wire-named; a transport takes canonical camelCase).
 *
 * Two ways a row dies, one check each:
 *
 *  1. **Unconditional transport** — `dashscope` resolved one for every image model, so
 *     `DASHSCOPE_WIRE_PROFILE` (`negative_prompt`/`seed`/`style`) was never built while
 *     `dashscopeTransport` read the camelCase keys off the raw bag.
 *  2. **Coupled routing** — `dmxapi` got its own SDK id from `config.ts` under exactly
 *     the predicate that also gives it a transport (`dmxapiUsesCustomTransport`), so
 *     `providerId === 'dmxapi'` implied the job branch and `WIRE_REGISTRY.dmxapi` (plus
 *     its `also: google` block) could not be reached from either side.
 */

// providerToAiSdkConfig reads the rotated API key (and Vertex/Bedrock auth) off the
// direct-import ProviderService singleton; mock it so the builders run without a DB.
const { getRotatedApiKeyMock, getAuthConfigMock, getByProviderIdMock } = vi.hoisted(() => ({
  getRotatedApiKeyMock: vi.fn<(providerId: string) => string>(() => 'sk-test'),
  getAuthConfigMock: vi.fn<(providerId: string) => AuthConfig | null>(
    () => ({ type: 'iam-gcp', project: 'p', location: 'us-central1' }) as AuthConfig
  ),
  getByProviderIdMock: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock,
    getAuthConfig: getAuthConfigMock,
    getByProviderId: getByProviderIdMock
  }
}))

const { providerToAiSdkConfig } = await import('../../../config')

/** Settings shaped like a resolved provider config — enough for every `build*Transport`. */
const PROBE_SETTINGS = { baseURL: 'https://example.invalid', apiKey: 'sk-probe' }

/** A model id no conditional resolver claims, so a transport here means "unconditional". */
const PROBE_MODEL_ID = '__reachability-probe-model__'

describe('WIRE_REGISTRY has no rows shadowed by an unconditional transport', () => {
  it('every registered provider can still reach the SDK delivery branch', () => {
    const shadowed = Object.keys(WIRE_REGISTRY).filter((providerId) =>
      Boolean(resolveImageTransport(providerId, PROBE_MODEL_ID, PROBE_SETTINGS, providerId))
    )

    expect(shadowed, 'these rows can never be read — the provider always takes a transport').toEqual([])
  })

  it('the probe is meaningful — an unconditional transport provider is detectable', () => {
    // Guards the guard: if this stops resolving, the test above silently passes for
    // every provider and the invariant is no longer enforced.
    expect(resolveImageTransport('ppio', PROBE_MODEL_ID, PROBE_SETTINGS, 'ppio')).not.toBeNull()
  })
})

// ── Registry-driven reachability (catches the coupled-routing shape) ──

const dataDir = resolve(process.cwd(), 'packages/provider-registry/data')
const readJson = (file: string) => JSON.parse(readFileSync(resolve(dataDir, file), 'utf8'))

type ImageGenerationSupport = { modes: Record<string, unknown> }
const providers: Array<{
  id: string
  defaultChatEndpoint?: EndpointType
  endpointConfigs?: Record<string, { baseUrl?: string; adapterFamily?: string }>
}> = readJson('providers.json').providers
const presetModels: Array<{ id: string; imageGeneration?: ImageGenerationSupport }> = readJson('models.json').models
const overrides: Array<{
  providerId: string
  modelId: string
  endpointTypes?: EndpointType[]
  imageGeneration?: ImageGenerationSupport
}> = readJson('provider-models.json').overrides

const providerById = new Map(providers.map((p) => [p.id, p]))
const presetById = new Map(presetModels.map((m) => [m.id, m]))

/** Every (provider, model) the registry declares image generation for. */
const imageModels = overrides.filter(
  (o) => (o.imageGeneration ?? presetById.get(o.modelId)?.imageGeneration) != null && providerById.has(o.providerId)
)

describe('WIRE_REGISTRY rows are reachable from a real declared model', () => {
  it('a row whose provider has declared image models is reached by at least one', async () => {
    const reachedOnSdkBranch = new Set<string>()

    for (const override of imageModels) {
      const provider = providerById.get(override.providerId)
      if (!provider) continue
      const sdkConfig = await providerToAiSdkConfig(
        makeProvider({
          id: provider.id,
          defaultChatEndpoint: provider.defaultChatEndpoint,
          endpointConfigs: provider.endpointConfigs as never
        }),
        makeModel({
          id: `${override.providerId}::${override.modelId}`,
          apiModelId: override.modelId,
          providerId: override.providerId,
          endpointTypes: override.endpointTypes
        })
      )
      const hasTransport = Boolean(
        resolveImageTransport(
          sdkConfig.providerId,
          override.modelId,
          sdkConfig.providerSettings,
          sdkConfig.concreteProviderId
        )
      )
      // Only the SDK branch consults WIRE_REGISTRY.
      if (!hasTransport) reachedOnSdkBranch.add(sdkConfig.providerId)
    }

    // Rows for providers with no declared image models can't be judged here — their
    // models live in the provider-agnostic `models.json` with no provider override, so
    // this check has no corpus for them. Only rows with a corpus are asserted.
    const providersWithCorpus = new Set(imageModels.map((o) => o.providerId))
    const judgeable = Object.keys(WIRE_REGISTRY).filter((id) => providersWithCorpus.has(id))
    const unreachable = judgeable.filter((id) => !reachedOnSdkBranch.has(id))

    expect(unreachable, 'no declared model routes here on the SDK branch — the row is dead').toEqual([])
  })
})
