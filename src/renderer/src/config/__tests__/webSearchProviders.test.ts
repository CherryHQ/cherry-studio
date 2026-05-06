import { afterEach, describe, expect, it, vi } from 'vitest'

import { filterSupportedWebSearchProviders } from '../webSearchProviders'

describe('webSearchProviders', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns once when unsupported web-search providers are dropped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const providers = [
      { id: 'zhipu', name: 'Zhipu' },
      { id: 'legacy-local', name: 'Legacy Local' }
    ]

    expect(filterSupportedWebSearchProviders(providers)).toEqual([{ id: 'zhipu', name: 'Zhipu' }])
    expect(filterSupportedWebSearchProviders(providers)).toEqual([{ id: 'zhipu', name: 'Zhipu' }])

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('Unsupported web-search provider dropped', {
      providerId: 'legacy-local'
    })
  })
})
