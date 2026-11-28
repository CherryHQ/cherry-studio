import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import i18n from '@renderer/i18n/resolver'
import type { ConversationListSort } from '@shared/data/types/conversationList'

import { useSessions } from '../agent/useSession'
import { useTopics } from '../useTopic'

vi.unmock('@data/hooks/useDataApi')

const sort = { by: 'name', direction: 'asc' } satisfies ConversationListSort

function useLocalizedTopics() {
  return useTopics({ sort, loadAll: true, pageSize: 2 }).topics
}

function useLocalizedSessions() {
  return useSessions(undefined, { sort, loadAll: true, pageSize: 2 }).sessions
}

describe('conversation language changes', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockDataApiService.get.mockImplementation(async (path, options) => {
      if (path === '/pins') return []
      const locale = options?.query?.sortLocale
      const cursor = options?.query?.cursor
      if (cursor && cursor !== `${locale}:next`) throw new Error('Cursor belongs to another locale')
      const names = locale === 'zh-CN' ? ['阿', '八', '中'] : ['八', '中', '阿']
      const items = (cursor ? names.slice(2) : names.slice(0, 2)).map((name) => ({
        id: name,
        name,
        orderKey: name,
        createdAt: '2026-11-18T00:00:00Z',
        lastActivityAt: '2026-11-18T00:00:00Z',
        updatedAt: '2026-11-18T00:00:00Z'
      }))
      return { items, nextCursor: cursor ? undefined : `${locale}:next` }
    })
  })

  // Reusing the old query key or page cursor would leave the previous language's order on screen.
  it.each([
    ['topics', useLocalizedTopics],
    ['sessions', useLocalizedSessions]
  ] as const)('starts a fresh localized page chain for %s', async (_name, useList) => {
    const { Wrapper } = createSWRTestWrapper()
    const { result } = renderHook(useList, { wrapper: Wrapper })
    await waitFor(() => expect(result.current.map((row) => row.name)).toEqual(['阿', '八', '中']))
    await act(async () => {
      await i18n.changeLanguage('zh-TW')
    })
    await waitFor(() => expect(result.current.map((row) => row.name)).toEqual(['八', '中', '阿']))
  })
})
