import type * as AnthropicSdk from '@ai-sdk/anthropic'
import { describe, expect, it, vi } from 'vitest'

const { createAnthropicMock } = vi.hoisted(() => ({ createAnthropicMock: vi.fn(() => ({})) }))

vi.mock('@ai-sdk/anthropic', async (importOriginal) => ({
  ...(await importOriginal<typeof AnthropicSdk>()),
  createAnthropic: createAnthropicMock
}))

const { coreExtensions } = await import('../core/initialization')

describe('core extension fetch forwarding', () => {
  it('forwards the injected fetch through the Azure Anthropic variant', () => {
    const extension = coreExtensions.find((item) => item.config.name === 'azure')
    if (!extension || !('variants' in extension.config)) throw new Error('Azure extension variants are unavailable')
    const variant = extension.config.variants.find((item) => item.suffix === 'anthropic')
    if (!variant || !('transform' in variant)) throw new Error('Azure Anthropic transform is unavailable')
    const sentinelFetch = vi.fn()

    variant.transform({} as never, {
      baseURL: 'https://example.openai.azure.com',
      apiKey: 'test',
      headers: { 'x-test': '1' },
      fetch: sentinelFetch
    })

    expect(createAnthropicMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fetch: sentinelFetch
      })
    )
  })
})
