import { mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { useMutation } from '@data/hooks/useDataApi'
import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingList } from '../usePaintingList'

type PaintingMutationArgs =
  | Partial<NonNullable<Parameters<ReturnType<typeof useMutation<'/paintings/:id', 'PATCH'>>['trigger']>[0]>>
  | undefined

const {
  createPainting,
  updatePainting,
  deletePainting,
  getActiveResource,
  refresh,
  restorePainting,
  showRecycleBinUndo
} = vi.hoisted(() => ({
  createPainting: vi.fn(),
  updatePainting: vi.fn(),
  deletePainting: vi.fn(),
  getActiveResource: vi.fn(),
  refresh: vi.fn(),
  restorePainting: vi.fn(),
  showRecycleBinUndo: vi.fn()
}))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: { get: getActiveResource }
}))

vi.mock('@renderer/services/recycleBinFeedback', () => ({ showRecycleBinUndo }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'recycle_bin.already_moved' ? 'Already in Recycle Bin' : key)
  })
}))

function makePainting(overrides: Partial<PaintingData>): PaintingData {
  return {
    id: 'p',
    providerId: 'silicon',
    mode: 'generate',
    prompt: '',
    files: [],
    params: {},
    ...overrides
  }
}

function renderList(input: Partial<Parameters<typeof usePaintingList>[0]>) {
  const setCurrentPainting = vi.fn()
  const cancelGeneration = vi.fn()
  const result = renderHook(() =>
    usePaintingList({
      painting: makePainting({ id: 'current', persistedAt: '2026-01-01T00:00:00.000Z' }),
      setCurrentPainting,
      draftDefaults: { providerId: 'silicon' },
      historyItems: [],
      cancelGeneration,
      ...input
    })
  )
  return { ...result, setCurrentPainting, cancelGeneration }
}

describe('usePaintingList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updatePainting.mockReset().mockResolvedValue(undefined)
    deletePainting.mockResolvedValue(undefined)
    getActiveResource.mockResolvedValue({ id: 'active-painting' })
    refresh.mockResolvedValue(undefined)
    restorePainting.mockResolvedValue(undefined)
    mockUseMutation.mockImplementation((method, path) => ({
      trigger:
        method === 'PATCH'
          ? (data: PaintingMutationArgs) => updatePainting(data?.params?.id, data?.body)
          : method === 'DELETE'
            ? (data: PaintingMutationArgs) => deletePainting(data?.params?.id)
            : path === '/paintings/:id/restore'
              ? (data: PaintingMutationArgs) => restorePainting(data?.params?.id)
              : createPainting,
      isLoading: false,
      error: undefined
    }))
    const query = mockUseQuery('/paintings')
    mockUseQuery.mockReturnValue({ ...query, refetch: refresh })
  })

  it('add() seeds a fresh in-memory draft without persisting it', async () => {
    const { result, setCurrentPainting } = renderList({})

    await act(async () => {
      await result.current.add()
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    const draft = setCurrentPainting.mock.calls[0][0] as PaintingData
    expect(draft).toMatchObject({ providerId: 'silicon', mode: 'generate', prompt: '', files: [] })
    // The whole point of the fix: a blank draft must NOT hit the DB / strip on click.
    expect(draft.persistedAt).toBeUndefined()
    expect(createPainting).not.toHaveBeenCalled()
  })

  it('add() uses the configured default model for a new draft', async () => {
    const { result, setCurrentPainting } = renderList({
      draftDefaults: { providerId: 'openai', modelId: 'dall-e-3' }
    })

    await act(async () => {
      await result.current.add()
    })

    expect(setCurrentPainting).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', model: 'dall-e-3' })
    )
  })

  it('saves prompt edits before New without overwriting generated references', async () => {
    let finish!: () => void
    updatePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const { result, setCurrentPainting } = renderList({
      painting: makePainting({ id: 'saved', persistedAt: '2026-01-01', prompt: 'Edited prompt' })
    })
    let adding!: Promise<void>
    act(() => {
      adding = result.current.add()
    })
    expect(updatePainting).toHaveBeenCalledWith('saved', {
      prompt: 'Edited prompt',
      providerId: 'silicon',
      modelId: undefined
    })
    expect(setCurrentPainting).not.toHaveBeenCalled()
    await act(async () => {
      finish()
      await adding
    })
    expect(setCurrentPainting).toHaveBeenCalledWith(expect.objectContaining({ prompt: '' }))
  })

  it('keeps edits on save failure and allows retry', async () => {
    updatePainting.mockRejectedValueOnce(new Error('Save failed'))
    const { result, setCurrentPainting } = renderList({})
    await act(async () => {
      await result.current.add()
    })
    expect(setCurrentPainting).not.toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
    await act(async () => {
      await result.current.add()
    })
    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
  })

  it('does not save an ungenerated draft', async () => {
    const { result } = renderList({ painting: makePainting({ prompt: 'Unsaved draft' }) })
    await act(async () => {
      await result.current.add()
    })
    expect(updatePainting).not.toHaveBeenCalled()
    expect(createPainting).not.toHaveBeenCalled()
  })

  it('opens an empty draft after deleting the last record without saving it', async () => {
    const painting = makePainting({ id: 'last', persistedAt: '2026-01-01' })
    const { result, setCurrentPainting } = renderList({ painting })
    await act(async () => {
      await result.current.remove(painting)
    })
    expect(updatePainting).not.toHaveBeenCalled()
    expect(setCurrentPainting).toHaveBeenCalledWith(expect.objectContaining({ prompt: '' }))
  })

  it('locks New while saving and does not cancel it for generation updates', async () => {
    let finish!: () => void
    updatePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const painting = makePainting({ id: 'saved', prompt: 'Edited', persistedAt: '2026-01-01' })
    const setCurrentPainting = vi.fn()
    const { result, rerender } = renderHook(
      (current) =>
        usePaintingList({
          painting: current,
          setCurrentPainting,
          draftDefaults: { providerId: 'silicon' },
          historyItems: [],
          cancelGeneration: vi.fn()
        }),
      { initialProps: painting }
    )
    let adding!: Promise<void>
    act(() => {
      adding = result.current.add()
    })
    expect(result.current.saving).toBe(true)
    await act(async () => {
      await result.current.add()
    })
    expect(updatePainting).toHaveBeenCalledTimes(1)
    rerender({ ...painting, generationStatus: 'running' })
    await act(async () => {
      finish()
      await adding
    })
    expect(result.current.saving).toBe(false)
    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
  })

  it('remove() deletes the record then refreshes the strip', async () => {
    const target = makePainting({ id: 'other', persistedAt: '2026-01-01T00:00:00.000Z' })
    const { result, setCurrentPainting, cancelGeneration } = renderList({})

    await act(async () => {
      await result.current.remove(target)
    })

    expect(cancelGeneration).toHaveBeenCalledWith('other')
    expect(deletePainting).toHaveBeenCalledWith('other')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(setCurrentPainting).not.toHaveBeenCalled()
    expect(showRecycleBinUndo).toHaveBeenCalledWith({ itemName: 'other', onUndo: expect.any(Function) })

    await showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()

    expect(restorePainting).toHaveBeenCalledWith('other')
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('refreshes and reports an already-moved Painting without offering Undo', async () => {
    const target = makePainting({ id: 'stale', persistedAt: '2026-01-01T00:00:00.000Z' })
    deletePainting.mockRejectedValueOnce(DataApiErrorFactory.notFound('Painting', target.id))
    const { result } = renderList({})

    await act(async () => {
      await result.current.remove(target)
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith('Already in Recycle Bin')
    expect(showRecycleBinUndo).not.toHaveBeenCalled()
  })

  it('reconciles a stale current Painting before a failed refresh', async () => {
    const current = makePainting({ id: 'current', persistedAt: '2026-01-01T00:00:00.000Z' })
    const next = makePainting({ id: 'next', persistedAt: '2026-01-02T00:00:00.000Z' })
    deletePainting.mockRejectedValueOnce(DataApiErrorFactory.notFound('Painting', current.id))
    refresh.mockRejectedValueOnce(new Error('refresh failed'))
    const { result, setCurrentPainting } = renderList({ painting: current, historyItems: [current, next] })

    await act(async () => {
      await result.current.remove(current)
    })

    expect(setCurrentPainting).toHaveBeenCalledWith(next)
    expect(setCurrentPainting.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0])
    expect(toast.info).toHaveBeenCalledWith('Already in Recycle Bin')
    expect(showRecycleBinUndo).not.toHaveBeenCalled()
  })

  it('reconciles a deleted current Painting before refresh failure and still offers Undo', async () => {
    const current = makePainting({ id: 'current', persistedAt: '2026-01-01T00:00:00.000Z' })
    const next = makePainting({ id: 'next', persistedAt: '2026-01-02T00:00:00.000Z' })
    refresh.mockRejectedValueOnce(new Error('refresh failed'))
    const { result, setCurrentPainting } = renderList({ painting: current, historyItems: [current, next] })

    await act(async () => {
      await result.current.remove(current)
    })

    expect(setCurrentPainting).toHaveBeenCalledWith(next)
    expect(setCurrentPainting.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0])
    expect(showRecycleBinUndo).toHaveBeenCalledWith({ itemName: 'current', onUndo: expect.any(Function) })
  })

  it('does not fail Painting Undo when restore succeeds but the history refresh rejects', async () => {
    const target = makePainting({ id: 'other', persistedAt: '2026-01-01T00:00:00.000Z' })
    refresh.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('restore refresh failed'))
    const { result } = renderList({})

    await act(async () => {
      await result.current.remove(target)
    })

    await expect(showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()
    expect(restorePainting).toHaveBeenCalledWith('other')
  })

  it('treats Painting restore NOT_FOUND as complete only when refresh confirms it is active', async () => {
    const target = makePainting({ id: 'other', persistedAt: '2026-01-01T00:00:00.000Z' })
    restorePainting.mockRejectedValueOnce(DataApiErrorFactory.notFound('Painting', target.id))
    const { result } = renderList({})

    await act(async () => {
      await result.current.remove(target)
    })

    await expect(showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).resolves.toBeUndefined()
    expect(getActiveResource).toHaveBeenCalledWith('/paintings/other')
  })

  it('keeps Painting restore NOT_FOUND failed when refresh cannot find an active row', async () => {
    const target = makePainting({ id: 'other', persistedAt: '2026-01-01T00:00:00.000Z' })
    const restoreError = DataApiErrorFactory.notFound('Painting', target.id)
    restorePainting.mockRejectedValueOnce(restoreError)
    getActiveResource.mockRejectedValueOnce(DataApiErrorFactory.notFound('Painting', target.id))
    const { result } = renderList({})

    await act(async () => {
      await result.current.remove(target)
    })

    await expect(showRecycleBinUndo.mock.calls.at(-1)?.[0].onUndo()).rejects.toBe(restoreError)
  })
})
