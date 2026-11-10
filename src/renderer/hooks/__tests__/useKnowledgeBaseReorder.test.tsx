import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import type { ReorderKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'

vi.unmock('@data/hooks/useDataApi')

import { useKnowledgeBaseReorder, useKnowledgeBases } from '../useKnowledgeBase'

type Base = { id: string; name: string; groupId: string | null; orderKey: string }
const initial: Base[] = [
  { id: 'a', name: 'Alpha', groupId: 'g1', orderKey: 'a0' },
  { id: 'b', name: 'Beta', groupId: 'g2', orderKey: 'a1' },
  { id: 'c', name: 'Gamma', groupId: 'g1', orderKey: 'a2' }
]

beforeEach(() => {
  vi.mocked(dataApiService.get).mockReset()
  vi.mocked(dataApiService.patch).mockReset()
})

function renderReorder() {
  const { Wrapper } = createSWRTestWrapper()
  return renderHook(
    () => ({
      first: useKnowledgeBases(),
      second: useKnowledgeBases(),
      reorder: useKnowledgeBaseReorder()
    }),
    { wrapper: Wrapper }
  )
}

describe('knowledge base cached ordering', () => {
  it.each([
    [{ anchor: { before: 'a' }, groupId: 'g1' }, ['b', 'c', 'a']],
    [{ anchor: { before: 'b' }, groupId: 'g2' }, ['a', 'c', 'b']],
    [{ anchor: { position: 'last' }, groupId: null }, ['a', 'b', 'c']]
  ] as const)('publishes membership and scoped ordering to every list subscriber: %j', async (request, expectedIds) => {
    vi.mocked(dataApiService.get).mockResolvedValue({ items: initial, total: 3, nextCursor: null })
    vi.mocked(dataApiService.patch).mockImplementation(() => new Promise(() => {}))
    const { result } = renderReorder()
    await waitFor(() => expect(result.current.first.bases).toHaveLength(3))
    act(() => {
      void result.current.reorder.move('c', request)
    })
    await waitFor(() => expect(result.current.first.bases.map((base) => base.id)).toEqual(expectedIds))

    expect(result.current.second.bases).toEqual(result.current.first.bases)
    expect(result.current.second.bases.find((base) => base.id === 'c')?.groupId).toBe(request.groupId)
    expect(result.current.second.bases.find((base) => base.id === 'a')?.groupId).toBe('g1')
    expect(result.current.second.bases.find((base) => base.id === 'b')?.groupId).toBe('g2')
    expect(result.current.reorder.isPending).toBe(true)
    expect(dataApiService.patch).toHaveBeenCalledWith('/knowledge-bases/c/order', { body: request, query: undefined })
  })

  it.each([false, true])(
    'shows refreshes during a pending move and reconciles completion (failure=%s)',
    async (fail) => {
      let server = initial
      vi.mocked(dataApiService.get).mockImplementation(async () => ({
        items: server,
        total: server.length,
        nextCursor: null
      }))
      let finish!: () => void
      vi.mocked(dataApiService.patch).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = () => (fail ? reject(new Error('move rejected')) : resolve(undefined))
          })
      )
      const { result } = renderReorder()
      await waitFor(() => expect(result.current.first.bases).toHaveLength(3))
      const request: ReorderKnowledgeBaseDto = { groupId: 'g2', anchor: { position: 'last' } }
      let operation!: Promise<void>
      act(() => {
        operation = result.current.reorder.move('c', request).catch((error) => {
          if (!fail) throw error
        })
      })
      await waitFor(() => expect(dataApiService.patch).toHaveBeenCalled())
      expect(result.current.second.bases.find((base) => base.id === 'c')?.groupId).toBe('g2')

      server = initial.map((base) => (base.id === 'a' ? { ...base, name: 'Renamed while saving' } : base))
      await act(async () => {
        await result.current.first.refetch()
      })
      expect(result.current.first.bases.find((base) => base.id === 'a')?.name).toBe('Renamed while saving')
      expect(result.current.second.bases.find((base) => base.id === 'a')?.name).toBe('Renamed while saving')

      if (!fail) server = server.map((base) => (base.id === 'c' ? { ...base, groupId: 'g2' } : base))
      await act(async () => {
        finish()
        await operation
      })
      expect(result.current.first.bases).toEqual(server)
      expect(result.current.second.bases).toEqual(server)
      expect(result.current.reorder.isPending).toBe(false)
    }
  )
})
