import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PaintingsRoute from '../route/PaintingsRoute'

const { mockUseAllProviders, mockPaintingWorkspace, mockNavigate, mockUseParams } = vi.hoisted(() => ({
  mockUseAllProviders: vi.fn(),
  mockPaintingWorkspace: vi.fn(() => null),
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

vi.mock('../workspace/PaintingWorkspace', () => ({
  default: mockPaintingWorkspace
}))

vi.mock('../providers', () => ({
  providerRegistry: {
    zhipu: { providerId: 'zhipu' },
    silicon: { providerId: 'silicon' },
    ovms: { providerId: 'ovms' }
  }
}))

vi.mock('../providers/newapi', () => ({
  createNewApiProvider: vi.fn((providerId: string) => ({ providerId }))
}))

describe('PaintingsRoute', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    mockUseAllProviders.mockReset()
    mockPaintingWorkspace.mockClear()
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

    render(<PaintingsRoute />)

    await waitFor(() => {
      expect(mockPaintingWorkspace).toHaveBeenCalledWith(
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

  it('should write the selected provider back through preference when PaintingWorkspace requests a change', async () => {
    const setDefaultPaintingProvider = vi.fn().mockResolvedValue(undefined)

    mockUsePreference.mockImplementation((key: string) => {
      if (key === 'feature.paintings.default_provider') {
        return ['zhipu', setDefaultPaintingProvider]
      }

      return [null, vi.fn().mockResolvedValue(undefined)]
    })

    render(<PaintingsRoute />)

    await waitFor(() => expect(mockPaintingWorkspace).toHaveBeenCalled())

    const paintingPageCalls = mockPaintingWorkspace.mock.calls as unknown as Array<
      [{ onProviderChange: (providerId: string) => void }]
    >
    const latestCall = paintingPageCalls.length > 0 ? paintingPageCalls[paintingPageCalls.length - 1]?.[0] : undefined
    expect(latestCall).toBeDefined()

    await act(async () => {
      latestCall?.onProviderChange('silicon')
    })

    expect(setDefaultPaintingProvider).toHaveBeenCalledWith('silicon')
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/app/paintings/silicon' })
  })
})
