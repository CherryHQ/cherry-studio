import type { WebSearchProvider } from '@renderer/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DefaultProvider from '../DefaultProvider'
import WebSearchProviderFactory from '../WebSearchProviderFactory'

describe('WebSearchProviderFactory', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs unsupported provider ids before falling back to DefaultProvider', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const provider = {
      id: 'legacy-local',
      name: 'Legacy Local'
    } as unknown as WebSearchProvider

    expect(WebSearchProviderFactory.create(provider)).toBeInstanceOf(DefaultProvider)
    expect(errorSpy).toHaveBeenCalledWith('Unsupported web-search provider id', {
      providerId: 'legacy-local'
    })
  })
})
