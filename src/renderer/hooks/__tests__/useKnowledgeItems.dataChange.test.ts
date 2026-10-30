import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import { usePreviewKnowledgeSource } from '@renderer/pages/knowledge/hooks/usePreviewKnowledgeSource'
import type { KnowledgeItemListItem, KnowledgeItemListResponse } from '@shared/data/api/schemas/knowledges'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

import { useKnowledgeItems } from '../useKnowledgeItems'

vi.unmock('@data/hooks/useDataApi')

const mockIpcRequest = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mockIpcRequest } }))

const makeItem = (id: string, title: string, baseId = 'base-1'): KnowledgeItemListItem => ({
  id,
  baseId,
  groupId: null,
  type: 'external',
  data: {
    source: 'https://example.com/wiki/document',
    title,
    relativePath: KnowledgeRelativePathSchema.parse(`external/${id}.md`)
  },
  status: 'completed',
  error: null,
  createdAt: '2026-09-27T10:00:00Z',
  updatedAt: '2026-09-27T10:00:00Z',
  canDelete: true
})

const notifyItemsChanged = (baseId: string) =>
  MockDataApiUtils.emitDataChange([
    { endpoint: '/knowledge-bases/:id/items', kind: 'membership', routeParams: { id: baseId } }
  ])

describe('useKnowledgeItems data change convergence', () => {
  beforeEach(() => {
    MockDataApiUtils.resetMocks()
    mockIpcRequest.mockReset()
  })

  it('previews the replacement snapshot after sync without polling or remounting', async () => {
    const oldItem = makeItem('old-item', 'Original document')
    const newItem = makeItem('new-item', 'Updated document')
    const snapshotPaths = new Map([['old-item', '/knowledge/base-1/raw/external/old-item.md']])
    mockIpcRequest.mockImplementation(async (_route, { itemId }: { itemId: string }) => {
      const path = snapshotPaths.get(itemId)
      if (!path) {
        throw new IpcError(knowledgeErrorCodes.SOURCE_PATH_UNAVAILABLE, 'Knowledge source path is unavailable')
      }
      return path
    })
    const previewFile = vi.fn()
    const setItems = (items: KnowledgeItemListItem[]) =>
      MockDataApiUtils.setCustomResponse('/knowledge-bases/base-1/items', 'GET', { items, total: items.length })
    setItems([oldItem])
    const { Wrapper } = createSWRTestWrapper()
    const { result } = renderHook(
      () => ({ ...useKnowledgeItems('base-1'), ...usePreviewKnowledgeSource(previewFile) }),
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(result.current.items).toEqual([oldItem]))
    await act(async () => result.current.previewSource(result.current.items[0]))
    expect(previewFile).toHaveBeenCalledExactlyOnceWith({
      fileName: 'Original document',
      filePath: '/knowledge/base-1/raw/external/old-item.md'
    })
    previewFile.mockClear()

    setItems([newItem])
    snapshotPaths.delete(oldItem.id)
    snapshotPaths.set(newItem.id, '/knowledge/base-1/raw/external/new-item.md')
    await act(async () => notifyItemsChanged('base-1'))

    await waitFor(() => expect(result.current.items).toEqual([newItem]))
    expect(result.current.total).toBe(1)
    await act(async () => result.current.previewSource(result.current.items[0]))
    expect(mockIpcRequest).toHaveBeenLastCalledWith('knowledge.get_file_path', { itemId: 'new-item' })
    expect(previewFile).toHaveBeenCalledExactlyOnceWith({
      fileName: 'Updated document',
      filePath: '/knowledge/base-1/raw/external/new-item.md'
    })
  })

  it('refreshes every loaded page without collapsing pagination after sync', async () => {
    const firstItem = makeItem('first-item', 'First page')
    const oldItem = makeItem('old-item', 'Original document')
    const newItem = makeItem('new-item', 'Updated document')
    let secondPage: KnowledgeItemListResponse = { items: [oldItem], total: 2 }
    vi.mocked(dataApiService.get).mockImplementation(async (_path, options) => {
      const query = options?.query as { cursor?: string }
      return query.cursor ? secondPage : { items: [firstItem], total: 2, nextCursor: 'second-page' }
    })
    const { Wrapper } = createSWRTestWrapper()
    const { result } = renderHook(() => useKnowledgeItems('base-1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.items).toEqual([firstItem]))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual([firstItem, oldItem]))

    secondPage = { items: [newItem], total: 2 }
    await act(async () => notifyItemsChanged('base-1'))

    await waitFor(() => expect(result.current.items).toEqual([firstItem, newItem]))
    expect(result.current.hasMore).toBe(false)
    expect(result.current.isLoadingMore).toBe(false)
  })

  it('only fetches the selected base when a scoped change arrives, including after switching bases', async () => {
    const item = makeItem('old-item', 'Original document')
    const otherBaseItem = makeItem('other-item', 'Other document', 'base-2')
    const updated = makeItem('new-item', 'Updated document', 'base-2')
    vi.mocked(dataApiService.get).mockResolvedValue({ items: [item], total: 1 })
    const { Wrapper } = createSWRTestWrapper()
    const { result, rerender } = renderHook(({ baseId }) => useKnowledgeItems(baseId), {
      initialProps: { baseId: 'base-1' },
      wrapper: Wrapper
    })
    await waitFor(() => expect(result.current.items).toEqual([item]))
    vi.mocked(dataApiService.get).mockResolvedValue({ items: [otherBaseItem], total: 1 })
    rerender({ baseId: 'base-2' })
    await waitFor(() => expect(result.current.items).toEqual([otherBaseItem]))

    vi.mocked(dataApiService.get)
      .mockClear()
      .mockResolvedValue({ items: [updated], total: 1 })
    await act(async () => notifyItemsChanged('base-1'))
    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([otherBaseItem])

    await act(async () => notifyItemsChanged('base-2'))
    await waitFor(() => expect(result.current.items).toEqual([updated]))
  })
})
