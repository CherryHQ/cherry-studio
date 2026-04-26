import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderLogos } from '../useProviderLogos'

const getMock = vi.fn()
const setMock = vi.fn()

vi.mock('@renderer/services/ImageStorage', () => ({
  default: {
    get: (...args: any[]) => getMock(...args),
    set: (...args: any[]) => setMock(...args)
  }
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })

  return { promise, resolve }
}

describe('useProviderLogos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMock.mockResolvedValue(undefined)
  })

  it('loads provider logos in parallel and updates local state on save and clear', async () => {
    const openAiLogo = createDeferred<string>()
    const anthropicLogo = createDeferred<string>()

    getMock.mockImplementation((key: string) => {
      if (key === 'provider-openai') {
        return openAiLogo.promise
      }

      if (key === 'provider-anthropic') {
        return anthropicLogo.promise
      }

      return Promise.resolve('')
    })

    const { result } = renderHook(() =>
      useProviderLogos([
        { id: 'openai', name: 'OpenAI' },
        { id: 'anthropic', name: 'Anthropic' }
      ] as any)
    )

    expect(getMock).toHaveBeenCalledTimes(2)
    expect(getMock).toHaveBeenNthCalledWith(1, 'provider-openai')
    expect(getMock).toHaveBeenNthCalledWith(2, 'provider-anthropic')

    await act(async () => {
      openAiLogo.resolve('logo-openai')
      anthropicLogo.resolve('logo-anthropic')
      await Promise.all([openAiLogo.promise, anthropicLogo.promise])
    })

    await waitFor(() =>
      expect(result.current.logos).toEqual({
        openai: 'logo-openai',
        anthropic: 'logo-anthropic'
      })
    )

    await act(async () => {
      await result.current.saveLogo('openai', 'logo-updated')
    })

    expect(setMock).toHaveBeenCalledWith('provider-openai', 'logo-updated')
    expect(result.current.logos).toEqual({
      openai: 'logo-updated',
      anthropic: 'logo-anthropic'
    })

    await act(async () => {
      await result.current.clearLogo('anthropic')
    })

    expect(setMock).toHaveBeenCalledWith('provider-anthropic', '')
    expect(result.current.logos).toEqual({
      openai: 'logo-updated'
    })
  })
})
