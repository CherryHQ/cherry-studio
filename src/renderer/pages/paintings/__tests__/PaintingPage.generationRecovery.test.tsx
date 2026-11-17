import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { mockUseInfiniteFlatItems, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

vi.mock('@data/hooks/useCache', async (importOriginal) => importOriginal())

vi.mock('@renderer/utils/uuid', () => ({ uuid: () => 'painting-recovery' }))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: ReactNode }) => children
}))

vi.mock('../components/PaintingComposer', () => ({ default: () => null }))
vi.mock('../components/PaintingStrip', () => ({ default: () => null }))

import PaintingPage from '../PaintingPage'

const cacheKey = 'painting.generation.painting-recovery'

describe('PaintingPage cached generation recovery', () => {
  beforeEach(async () => {
    MockCacheUtils.resetMocks()
    await i18n.changeLanguage('en-US')
    const historyItems: never[] = []
    mockUseInfiniteFlatItems.mockReturnValue(historyItems)
    mockUseQuery.mockImplementation((path) => ({
      data: (path === '/providers' || path === '/models' ? [] : undefined) as never,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: async () => undefined,
      mutate: async () => undefined
    }))
  })

  it.each(['failed', 'canceled'] as const)(
    'stops waiting for an image when a cached run becomes %s',
    async (status) => {
      cacheService.set(cacheKey, { status: 'running', taskId: null, error: null, progress: 0 })
      await act(async () => {
        render(<PaintingPage />)
      })

      expect(
        screen.getByRole('status', { name: 'Drawing in progress. Please do not leave this page.' })
      ).toBeInTheDocument()

      act(() => {
        cacheService.set(cacheKey, {
          status,
          taskId: null,
          error: status === 'failed' ? 'Request timed out' : null,
          progress: 0
        })
      })

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'No image available' })).toBeInTheDocument()
    }
  )
})
