import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingList } from '../usePaintingList'

const { createPainting, updatePainting, deletePainting, refresh } = vi.hoisted(() => ({
  createPainting: vi.fn(),
  updatePainting: vi.fn(),
  deletePainting: vi.fn(),
  refresh: vi.fn()
}))

vi.mock('@renderer/hooks/usePaintings', () => ({
  usePaintings: () => ({
    records: [],
    total: 0,
    isLoading: false,
    refresh,
    createPainting,
    updatePainting,
    deletePainting,
    reorderPaintings: vi.fn()
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
    refresh.mockResolvedValue(undefined)
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

  it.each(['prompt', 'id', 'generationStatus'] as const)('handles %s changes during the New save', async (field) => {
    const painting = makePainting({ id: 'saved', prompt: 'Edited', persistedAt: '2026-01-01' })
    const setCurrentPainting = vi.fn()
    let finish!: () => void
    updatePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
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
    rerender({ ...painting, [field]: field === 'generationStatus' ? 'running' : 'newer' })
    await act(async () => {
      finish()
      await adding
    })
    expect(setCurrentPainting).toHaveBeenCalledTimes(field === 'generationStatus' ? 1 : 0)
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
  })
})
