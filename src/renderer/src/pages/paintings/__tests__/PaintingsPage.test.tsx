import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PaintingsPage from '../PaintingsPage'

const { mockUseAllProviders, mockPaintingPage, mockNavigate, mockUseParams } = vi.hoisted(() => ({
  mockUseAllProviders: vi.fn(),
  mockPaintingPage: vi.fn(() => null),
  mockNavigate: vi.fn(),
  mockUseParams: vi.fn()
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useAllProviders: mockUseAllProviders
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams()
}))

vi.mock('../PaintingPage', () => ({
  default: mockPaintingPage
}))

vi.mock('../providers', () => ({
  providerRegistry: {
    zhipu: { providerId: 'zhipu' },
    silicon: { providerId: 'silicon' },
    ovms: { providerId: 'ovms' }
  }
}))

vi.mock('../providers/newApiProvider', () => ({
  createNewApiProvider: vi.fn((providerId: string) => ({ providerId }))
}))

describe('PaintingsPage', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mockUseAllProviders.mockReset()
    mockPaintingPage.mockClear()
    mockNavigate.mockReset()
    mockUseParams.mockReset()
    mockUseAllProviders.mockReturnValue([])
    mockUseParams.mockReturnValue({ _splat: undefined })

    window.api.ovms = {
      isSupported: vi.fn().mockResolvedValue(false),
      getStatus: vi.fn().mockResolvedValue('not-running')
    } as never
  })

  it('should fall back to zhipu and persist the resolved provider in v2 preference', async () => {
    const setDefaultPaintingProvider = vi.fn().mockResolvedValue(undefined)

    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'feature.paintings.default_provider') {
        return [null, setDefaultPaintingProvider]
      }

      return [null, vi.fn().mockResolvedValue(undefined)]
    })

    render(<PaintingsPage />)

    await waitFor(() => {
      expect(mockPaintingPage).toHaveBeenCalledWith(
        expect.objectContaining({
          definition: expect.objectContaining({ providerId: 'zhipu' })
        }),
        undefined
      )
    })

    await waitFor(() => {
      expect(setDefaultPaintingProvider).toHaveBeenCalledWith('zhipu')
    })
  })

  it('should write the selected provider back through preference when PaintingPage requests a change', async () => {
    const setDefaultPaintingProvider = vi.fn().mockResolvedValue(undefined)

    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'feature.paintings.default_provider') {
        return ['zhipu', setDefaultPaintingProvider]
      }

      return [null, vi.fn().mockResolvedValue(undefined)]
    })

    render(<PaintingsPage />)

    await waitFor(() => expect(mockPaintingPage).toHaveBeenCalled())

    const latestCall = mockPaintingPage.mock.calls.at(-1)?.[0]

    await act(async () => {
      latestCall.onProviderChange('silicon')
    })

    expect(setDefaultPaintingProvider).toHaveBeenCalledWith('silicon')
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/app/paintings/silicon' })
  })
})
