import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUsePreference } = vi.hoisted(() => ({
  mockUsePreference: vi.fn()
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: mockUsePreference
}))

import { useWebSearchProviders } from '../useWebSearchProviders'

describe('useWebSearchProviders', () => {
  beforeEach(() => {
    mockUsePreference.mockReset()
  })

  it('resolves providers from presets without legacy url fields', () => {
    mockUsePreference.mockReturnValue([{}, vi.fn().mockResolvedValue(undefined)])

    const { result } = renderHook(() => useWebSearchProviders())
    const provider = result.current.providers.find((item) => item.id === 'local-bing')

    expect(provider).toMatchObject({
      id: 'local-bing',
      type: 'local',
      usingBrowser: true,
      apiHost: 'https://cn.bing.com/search?q=%s&ensearch=1'
    })
    expect(provider).not.toHaveProperty('url')
  })

  it('preserves an existing apiKey when updating apiHost', () => {
    const setProviderOverrides = vi.fn().mockResolvedValue(undefined)

    mockUsePreference.mockReturnValue([
      {
        zhipu: {
          apiKey: 'sk-test'
        }
      },
      setProviderOverrides
    ])

    const { result } = renderHook(() => useWebSearchProviders())

    act(() => {
      result.current.updateProvider('zhipu', {
        apiHost: 'https://proxy.example.com'
      })
    })

    expect(setProviderOverrides).toHaveBeenCalledWith({
      zhipu: {
        apiKey: 'sk-test',
        apiHost: 'https://proxy.example.com'
      }
    })
  })
})
