import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { coreExtensions, type ProviderExtensionConfig } from '@cherrystudio/ai-core/provider'
import { isServerToolModelEligible, SERVER_TOOL } from '@cherrystudio/provider-registry'
import { readModelRegistry, readProviderRegistry } from '@cherrystudio/provider-registry/node'

import { BedrockExtension, extensions } from '../extensions'

/**
 * Bedrock runs Anthropic models, so its provider exposes the same server-side
 * web-search / web-fetch tools as the native `anthropic` extension. These
 * factories must be wired (regression for the dropped-during-port gap).
 */
describe('BedrockExtension toolFactories', () => {
  const fakeProvider = {
    tools: {
      webSearch_20260209: (config: unknown) => ({ tool: 'webSearch_20260209', config }),
      webFetch_20260209: (config: unknown) => ({ tool: 'webFetch_20260209', config })
    }
  }

  it('wires webSearch to the provider web-search tool', () => {
    const factory = BedrockExtension.config.toolFactories?.webSearch
    expect(factory).toBeDefined()
    const result = factory(fakeProvider as any)({ maxUses: 3 } as any)
    expect(result).toEqual({ tools: { webSearch: { tool: 'webSearch_20260209', config: { maxUses: 3 } } } })
  })

  it('wires urlContext to the provider web-fetch tool', () => {
    const factory = BedrockExtension.config.toolFactories?.urlContext
    expect(factory).toBeDefined()
    const result = factory(fakeProvider as any)({} as any)
    expect(result).toEqual({ tools: { urlContext: { tool: 'webFetch_20260209', config: {} } } })
  })

  it('keeps registry declarations aligned with direct web-search factories', () => {
    const { providers } = readProviderRegistry(
      path.join(process.cwd(), 'packages/provider-registry/data/providers.json')
    )

    for (const extension of [...coreExtensions, ...extensions]) {
      const config = extension.config as ProviderExtensionConfig
      const hasWebSearchFactory =
        Boolean(config.toolFactories?.webSearch) ||
        config.variants?.some((variant) => Boolean(variant.toolFactories?.webSearch))
      if (!hasWebSearchFactory) continue

      const providerIds = new Set([config.name, ...(config.aliases ?? [])])
      for (const provider of providers.filter(({ id }) => providerIds.has(id))) {
        expect(
          provider.serverTools,
          `${provider.id} has a direct webSearch factory but does not declare it`
        ).toContainEqual(expect.objectContaining({ id: 'web-search' }))
      }
    }
  })

  it('keeps Bedrock Web Search declared across the registry, extension, and model eligibility', () => {
    const { providers } = readProviderRegistry(
      path.join(process.cwd(), 'packages/provider-registry/data/providers.json')
    )
    const { models } = readModelRegistry(path.join(process.cwd(), 'packages/provider-registry/data/models.json'))
    const provider = providers.find(({ id }) => id === 'aws-bedrock')
    const model = models.find(({ id }) => id === 'claude-sonnet-4-6')

    expect(provider?.serverTools).toContainEqual(
      expect.objectContaining({ id: 'web-search', modelScope: 'model-dependent' })
    )
    expect(BedrockExtension.config.toolFactories?.webSearch).toBeDefined()
    expect(model && isServerToolModelEligible(model.id, 'aws-bedrock', SERVER_TOOL.WEB_SEARCH)).toBe(true)
    expect(model?.capabilities).not.toContain('web-search')
  })
})
