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

  it('add() saves prompt edits before replacing the current painting with a draft', async () => {
    const { result, setCurrentPainting } = renderList({
      painting: makePainting({ id: 'current', persistedAt: '2026-01-01', prompt: 'Revised prompt' })
    })
    let finishSave!: () => void
    updatePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        })
    )

    let pending!: Promise<void> | void
    act(() => {
      pending = result.current.add()
    })
    expect(setCurrentPainting).not.toHaveBeenCalled()
    expect(updatePainting).toHaveBeenCalledWith('current', expect.objectContaining({ prompt: 'Revised prompt' }))
    await act(async () => {
      finishSave()
      await pending
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    const draft = setCurrentPainting.mock.calls[0][0] as PaintingData
    expect(draft).toMatchObject({ providerId: 'silicon', mode: 'generate', prompt: '', files: [] })
    // The whole point of the fix: a blank draft must NOT hit the DB / strip on click.
    expect(draft.persistedAt).toBeUndefined()
    expect(createPainting).not.toHaveBeenCalled()
  })

  it('add() uses the configured default model without saving an unsaved draft', async () => {
    const { result, setCurrentPainting } = renderList({
      draftDefaults: { providerId: 'openai', modelId: 'dall-e-3' },
      painting: makePainting({ prompt: 'Unsaved draft' })
    })

    await act(async () => {
      await result.current.add()
    })

    expect(setCurrentPainting).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai', model: 'dall-e-3' })
    )
    expect(updatePainting).not.toHaveBeenCalled()
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

  it('add() keeps the edited painting selected when saving fails and allows retry', async () => {
    const { result, setCurrentPainting } = renderList({})
    updatePainting.mockRejectedValueOnce(new Error('Save failed'))
    await act(async () => {
      await result.current.add()
    })
    expect(setCurrentPainting).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.add()
    })
    expect(setCurrentPainting).toHaveBeenCalledWith(expect.objectContaining({ prompt: '', providerId: 'silicon' }))
  })

  it('add() preserves edits made while the previous prompt is being saved', async () => {
    const painting = makePainting({ id: 'current', persistedAt: '2026-01-01', prompt: 'First edit' })
    const setCurrentPainting = vi.fn()
    const { result, rerender } = renderHook(
      ({ current }) =>
        usePaintingList({
          painting: current,
          setCurrentPainting,
          draftDefaults: { providerId: 'silicon' },
          historyItems: [],
          cancelGeneration: vi.fn()
        }),
      { initialProps: { current: painting } }
    )
    let finishSave!: () => void
    updatePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        })
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add()
    })
    rerender({ current: { ...painting, prompt: 'Newer edit while saving' } })
    await act(async () => {
      finishSave()
      await pending
    })
    expect(setCurrentPainting).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.add()
    })
    expect(updatePainting).toHaveBeenLastCalledWith(
      'current',
      expect.objectContaining({ prompt: 'Newer edit while saving' })
    )
    expect(setCurrentPainting).toHaveBeenCalledWith(expect.objectContaining({ prompt: '' }))
  })

  it('remove() replaces the last painting with an unsaved draft without saving the deleted record', async () => {
    const target = makePainting({ id: 'current', persistedAt: '2026-01-01' })
    const { result, setCurrentPainting } = renderList({ painting: target, historyItems: [target] })
    await act(async () => {
      await result.current.remove(target)
    })
    expect(deletePainting).toHaveBeenCalledWith('current')
    expect(updatePainting).not.toHaveBeenCalled()
    const draft = setCurrentPainting.mock.calls[0][0] as PaintingData
    expect(draft.id).not.toBe('current')
    expect(draft.persistedAt).toBeUndefined()
    expect(draft.prompt).toBe('')
  })
})
