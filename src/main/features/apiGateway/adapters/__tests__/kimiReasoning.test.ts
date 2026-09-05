import path from 'node:path'

import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { mergePresetModel, providerRegistryService } from '@data/services/ProviderRegistryService'
import { resolveRegistryPaths } from '@data/services/utils/registryDataPaths'
import { resolveReasoningEffortForModel } from '@shared/ai/reasoning'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

import {
  mapAnthropicThinkingToProviderOptions,
  mapGeminiThinkingToProviderOptions,
  mapReasoningEffortToProviderOptions
} from '../converters/providerOptionsMapper'

// Use bundled files instead of the app's writable catalog directory;
// registry lookup, overrides, runtime projection and serialization stay real.
vi.mock('@data/services/utils/registryDataPaths', () => ({
  resolveRegistryPaths: () => ({
    models: path.resolve('packages/provider-registry/data/models.json'),
    providers: path.resolve('packages/provider-registry/data/providers.json'),
    providerModels: path.resolve('packages/provider-registry/data/provider-models.json')
  })
}))

const catalog = new RegistryLoader(resolveRegistryPaths())
const endpoint = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS

function kimiTarget(providerId: string) {
  const preset = catalog.findModel('kimi-k3')!
  const provider = {
    ...catalog.findProvider(providerId)!,
    defaultChatEndpoint: endpoint,
    apiKeys: [],
    authType: 'api-key',
    settings: {},
    isEnabled: true
  } as Provider
  const override = catalog.findOverride(providerId, preset.id)
  const seed = { ...mergePresetModel(preset, override, providerId), presetModelId: preset.id }
  const profile = providerRegistryService.resolveReasoningProfile(provider, seed, endpoint)
  const model = {
    ...mergePresetModel(preset, override, providerId, profile.wire, profile.support),
    presetModelId: preset.id,
    endpointTypes: [endpoint]
  }
  return { provider, model }
}

describe('Kimi K3 gateway reasoning (#20029)', () => {
  it.each([
    ['moonshot', 'high'],
    ['opencode', 'max'],
    ['dashscope', 'max'],
    ['openrouter', 'high']
  ])('normalizes automatic and legacy medium efforts for %s', (providerId, expected) => {
    const { provider, model } = kimiTarget(providerId)
    const options =
      providerId === 'openrouter'
        ? { openrouter: { reasoning: { effort: expected } } }
        : { [providerId]: { reasoningEffort: expected } }

    expect(mapAnthropicThinkingToProviderOptions(provider, model, { type: 'adaptive' })).toEqual(options)
    expect(mapGeminiThinkingToProviderOptions(provider, model, { thinkingBudget: -1 })).toEqual(options)
    expect(mapReasoningEffortToProviderOptions(provider, model, 'medium')).toEqual(options)
    // Both Chat and Agent composers use this shared model-switch resolver.
    expect(resolveReasoningEffortForModel(model, 'medium')).toBe(expected)
  })

  it.each(['low', 'high', 'max'] as const)('preserves a supported Moonshot %s selection', (effort) => {
    const { provider, model } = kimiTarget('moonshot')

    expect(mapAnthropicThinkingToProviderOptions(provider, model, { type: 'adaptive' }, effort)).toEqual({
      moonshot: { reasoningEffort: effort }
    })
    expect(resolveReasoningEffortForModel(model, effort)).toBe(effort)
  })
})
