/**
 * Regression test: the Azure base extension (chat mode) must expose the SDK
 * provider's `.tools` on its `customProvider` wrapper.
 *
 * `AzureExtension.create` defaults Azure to the chat API by wrapping
 * `createAzure(...)` with `customProvider`, which returns a plain object without
 * the SDK's `.tools`. `resolveToolCapability` hands that wrapper to
 * `toolFactories.webSearch`, so `provider.tools.webSearchPreview` used to throw
 * `TypeError: Cannot read properties of undefined (reading 'webSearchPreview')`
 * before any request was sent (issue #23013). These tests pin the fix for the
 * `azure` base id and its `azure-openai` alias, plus the untouched
 * `azure-responses` variant.
 */

import { describe, expect, it } from 'vitest'

import { ExtensionRegistry } from '../core/ExtensionRegistry'

const { coreExtensions } = await import('../core/initialization')

async function resolveWebSearchTool(registry: ExtensionRegistry, providerId: string) {
  const resolved = await registry.resolveToolCapability(providerId, 'webSearch')
  expect(resolved).toBeDefined()
  const patch = resolved!.factory(resolved!.provider)({})
  return patch.tools?.webSearch
}

function createCoreRegistry(): ExtensionRegistry {
  // Fresh registry per case — importing core/initialization registers
  // coreExtensions into the global singleton as an import side effect.
  const registry = new ExtensionRegistry()
  registry.registerAll(coreExtensions)
  return registry
}

describe('azure extension — webSearch capability', () => {
  it('azure base id resolves webSearch and produces the provider-defined tool', async () => {
    const tool = await resolveWebSearchTool(createCoreRegistry(), 'azure')

    expect(tool).toBeDefined()
    expect(tool.type).toBe('provider')
    expect(tool.id).toBe('openai.web_search_preview')
  })

  it('azure-openai alias resolves webSearch through the same path (issue #23013)', async () => {
    const tool = await resolveWebSearchTool(createCoreRegistry(), 'azure-openai')

    expect(tool).toBeDefined()
    expect(tool.type).toBe('provider')
    expect(tool.id).toBe('openai.web_search_preview')
  })

  it('azure-responses variant still resolves webSearch with the same tool', async () => {
    const tool = await resolveWebSearchTool(createCoreRegistry(), 'azure-responses')

    expect(tool).toBeDefined()
    expect(tool.type).toBe('provider')
    expect(tool.id).toBe('openai.web_search_preview')
  })
})
