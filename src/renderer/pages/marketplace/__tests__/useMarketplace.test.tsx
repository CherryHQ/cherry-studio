import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { MarketplaceSkill, MarketplaceSkillPage } from '@shared/types/skillMarketplace'

import { useMarketplace } from '../useMarketplace'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const cacheKey = 'feature.marketplace.skill_catalog'
const skill: MarketplaceSkill = {
  id: 'writing',
  name: { en: 'Writing', zh: null },
  description: { en: 'Write documents', zh: null },
  domain: 'Other',
  author: '',
  version: '',
  tags: [],
  githubRepoUrl: null,
  sourceUrl: null,
  icon: null,
  packageName: null,
  packageSize: null,
  hasPackage: true,
  downloadUrl: null,
  downloads: 0,
  releaseDate: '',
  members: [],
  membersKnown: false,
  isCollection: false
}

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
}

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
  vi.mocked(ipcApi.request).mockReset()
})
afterEach(cleanup)

it('shows persisted skills immediately, refreshes them, and reuses the result with a fresh memory cache', async () => {
  MockUseCacheUtils.setPersistCacheValue(cacheKey, [skill])
  const response = Promise.withResolvers<MarketplaceSkillPage>()
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'skill.marketplace.list' ? ((await response.promise) as never) : (undefined as never)
  )
  const first = renderHook(() => useMarketplace(), { wrapper })
  expect(first.result.current.catalog.data).toEqual([skill])
  expect(first.result.current.catalog.isLoading).toBe(false)
  expect(first.result.current.curatedCount).toBe(1)

  const updated = { ...skill, downloads: 25 }
  await act(async () => {
    response.resolve({ items: [updated], pagination: { offset: 0, limit: 100, total: 1, hasMore: false } })
  })
  await waitFor(() => expect(first.result.current.catalog.data).toEqual([updated]))
  expect(MockUseCacheUtils.getPersistCacheValue(cacheKey)).toEqual([updated])
  first.unmount()

  vi.mocked(ipcApi.request).mockImplementation(async (route) => {
    if (route === 'skill.marketplace.list') return new Promise<never>(() => {})
    return undefined as never
  })
  const reopened = renderHook(() => useMarketplace(), { wrapper })
  expect(reopened.result.current.catalog.data).toEqual([updated])
  expect(reopened.result.current.catalog.isLoading).toBe(false)
})

it('keeps the last complete catalog when refreshing fails after the first page', async () => {
  MockUseCacheUtils.setPersistCacheValue(cacheKey, [skill])
  vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
    if (route !== 'skill.marketplace.list') return undefined as never
    if ((input as { offset: number }).offset) throw new Error('Network unavailable')
    return {
      items: [{ ...skill, id: 'partial' }],
      pagination: { offset: 0, limit: 100, total: 101, hasMore: true }
    } as never
  })
  const { result } = renderHook(() => useMarketplace(), { wrapper })
  await waitFor(() => expect(result.current.catalog.error).toBeDefined())
  expect(result.current.catalog.data).toEqual([skill])
  expect(result.current.catalog.isLoading).toBe(false)
  expect(MockUseCacheUtils.getPersistCacheValue(cacheKey)).toEqual([skill])
})

it('shows initial loading without a cache and persists a successful empty catalog', async () => {
  const response = Promise.withResolvers<MarketplaceSkillPage>()
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'skill.marketplace.list' ? ((await response.promise) as never) : (undefined as never)
  )
  const { result } = renderHook(() => useMarketplace(), { wrapper })
  expect(result.current.catalog.isLoading).toBe(true)
  await act(async () => {
    response.resolve({ items: [], pagination: { offset: 0, limit: 100, total: 0, hasMore: false } })
  })
  await waitFor(() => expect(result.current.catalog.data).toEqual([]))
  expect(result.current.catalog.isLoading).toBe(false)
  expect(MockUseCacheUtils.getPersistCacheValue(cacheKey)).toEqual([])
})

it('keeps a subscription catalog separate from the persisted curated catalog', async () => {
  MockUseCacheUtils.setPersistCacheValue(cacheKey, [skill])
  const subscribed = { ...skill, id: 'subscribed' }
  vi.mocked(ipcApi.request).mockImplementation(async (route) => {
    if (route === 'skill.subscription.list' || route === 'skill.subscription.refresh') {
      return { items: [subscribed], skipped: 0 } as never
    }
    return undefined as never
  })
  const { result } = renderHook(() => useMarketplace('feed'), { wrapper })
  expect(result.current.catalog.data).not.toEqual([skill])
  await waitFor(() => expect(result.current.catalog.data).toEqual([subscribed]))
  expect(MockUseCacheUtils.getPersistCacheValue(cacheKey)).toEqual([skill])
})
