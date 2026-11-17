import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { coreExtensions, type ProviderExtensionConfig } from '@cherrystudio/ai-core/provider'
import { readProviderRegistry } from '@cherrystudio/provider-registry/node'

import { extensions } from '../extensions'

/**
 * Bedrock runs Anthropic models, so its provider exposes the same server-side
 * web-search / web-fetch tools as the native `anthropic` extension. These
 * factories must be wired (regression for the dropped-during-port gap).
 */
describe('BedrockExtension toolFactories', () => {
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
})
