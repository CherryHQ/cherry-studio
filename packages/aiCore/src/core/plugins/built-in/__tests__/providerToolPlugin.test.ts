import { afterEach, describe, expect, it, vi } from 'vitest'

import { extensionRegistry } from '../../../providers'
import { providerToolPlugin } from '../providerToolPlugin'

describe('providerToolPlugin', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replaces a same-name client fallback only after resolving a server implementation', async () => {
    const clientFallback = { execute: vi.fn() }
    const serverTool = { type: 'provider-defined' }
    vi.spyOn(extensionRegistry, 'resolveToolCapability').mockResolvedValue({
      provider: {} as never,
      factory: () => () => ({ tools: { web_search: serverTool } })
    })
    const plugin = providerToolPlugin('webSearch')
    const params = { tools: { web_search: clientFallback, web_fetch: {} } }

    const result = await plugin.transformParams!(params, {
      providerId: 'openai',
      model: { provider: 'openai' }
    } as never)

    expect(result.tools).toEqual({ web_search: serverTool, web_fetch: {} })
  })

  it('preserves the client fallback when no server implementation resolves', async () => {
    vi.spyOn(extensionRegistry, 'resolveToolCapability').mockResolvedValue(undefined)
    const plugin = providerToolPlugin('webSearch')
    const params = { tools: { web_search: { execute: vi.fn() } } }

    const result = await plugin.transformParams!(params, {
      providerId: 'unsupported',
      model: { provider: 'unsupported' }
    } as never)

    expect(result).toBe(params)
  })
})
