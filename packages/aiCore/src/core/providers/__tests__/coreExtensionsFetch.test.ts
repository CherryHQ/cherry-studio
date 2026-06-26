/**
 * Contract test: provider variants whose `transform` rebuilds the underlying SDK
 * provider from a curated subset of settings MUST forward the caller-injected
 * `fetch`. Cherry Studio injects a proxy-aware `customFetch` at the provider-config
 * layer; a variant that drops it silently routes requests through the SDK default
 * fetch, bypassing the proxy path. Regression guard for the `azure-anthropic` leak.
 */

import type * as AnthropicSdk from '@ai-sdk/anthropic'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { createAnthropicMock } = vi.hoisted(() => ({ createAnthropicMock: vi.fn(() => ({}) as any) }))
vi.mock('@ai-sdk/anthropic', async (importOriginal) => ({
  ...(await importOriginal<typeof AnthropicSdk>()),
  createAnthropic: createAnthropicMock
}))

const { coreExtensions } = await import('../core/initialization')

type AnyVariant = { suffix: string; transform?: (provider: unknown, settings: unknown) => unknown }

function getVariantTransform(extensionName: string, suffix: string) {
  const ext = coreExtensions.find((e) => e.config.name === extensionName)
  const variants = (ext?.config as { variants?: AnyVariant[] } | undefined)?.variants
  const variant = variants?.find((v) => v.suffix === suffix)
  if (!variant?.transform) throw new Error(`variant ${extensionName}-${suffix} has no transform`)
  return variant.transform
}

function anthropicCallOptions(index = 0): { fetch?: unknown } {
  const calls = createAnthropicMock.mock.calls as unknown as Array<[{ fetch?: unknown }]>
  return calls[index][0]
}

describe('core extensions — variant fetch forwarding', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('azure-anthropic forwards the injected fetch to createAnthropic', () => {
    const transform = getVariantTransform('azure', 'anthropic')
    const sentinelFetch = vi.fn()

    transform(
      {},
      { baseURL: 'https://example.openai.azure.com', apiKey: 'k', headers: { 'x-test': '1' }, fetch: sentinelFetch }
    )

    expect(createAnthropicMock).toHaveBeenCalledTimes(1)
    expect(anthropicCallOptions().fetch).toBe(sentinelFetch)
  })

  it('azure-anthropic passes fetch through as undefined when none is injected', () => {
    const transform = getVariantTransform('azure', 'anthropic')

    transform({}, { baseURL: 'https://example.openai.azure.com', apiKey: 'k' })

    expect(createAnthropicMock).toHaveBeenCalledTimes(1)
    expect(anthropicCallOptions()).toHaveProperty('fetch', undefined)
  })
})
