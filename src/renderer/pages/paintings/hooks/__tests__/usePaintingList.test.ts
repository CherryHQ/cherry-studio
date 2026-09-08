import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingList } from '../usePaintingList'
import { usePaintingSession } from '../usePaintingSession'

const { createPainting, updatePainting, deletePainting, refresh } = vi.hoisted(() => ({
  createPainting: vi.fn(),
  updatePainting: vi.fn(),
  deletePainting: vi.fn(),
  refresh: vi.fn()
}))
vi.mock('@renderer/hooks/usePaintings', () => ({
  usePaintings: () => ({ createPainting, updatePainting, deletePainting, refresh })
}))

function makePainting(overrides: Partial<PaintingData> = {}): PaintingData {
  return {
    id: 'current',
    providerId: 'silicon',
    mode: 'generate',
    prompt: 'Revised prompt',
    files: [],
    params: {},
    persistedAt: '2026-01-01',
    ...overrides
  }
}
function renderList(painting = makePainting()) {
  const cancelGeneration = vi.fn()
  return {
    cancelGeneration,
    ...renderHook(() => {
      const session = usePaintingSession(() => painting)
      const list = usePaintingList({
        painting: session.painting,
        setCurrentPainting: session.replace,
        beginTransition: session.beginTransition,
        draftDefaults: { providerId: 'openai', modelId: 'dall-e-3' },
        historyItems: [painting],
        cancelGeneration
      })
      return { ...list, session }
    })
  }
}
function delaySave() {
  let finish!: () => void
  updatePainting.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  return () => finish()
}

describe('painting editor navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updatePainting.mockReset().mockResolvedValue(undefined)
    deletePainting.mockResolvedValue(undefined)
    refresh.mockResolvedValue(undefined)
  })
  it('saves only the prompt before New, leaving generated references owned by generation', async () => {
    const { result } = renderList(makePainting({ files: [{ id: 'old-output' } as PaintingData['files'][number]] }))
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add()
    })
    expect(result.current.session.painting.id).toBe('current')
    expect(updatePainting).toHaveBeenCalledWith('current', { prompt: 'Revised prompt' })
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting).toMatchObject({
      providerId: 'openai',
      model: 'dall-e-3',
      prompt: '',
      files: []
    })
    expect(result.current.session.painting.persistedAt).toBeUndefined()
    expect(createPainting).not.toHaveBeenCalled()
  })
  it('does not persist an ungenerated draft', async () => {
    const { result } = renderList(makePainting({ persistedAt: undefined }))
    await act(async () => {
      await result.current.add()
    })
    expect(updatePainting).not.toHaveBeenCalled()
    expect(createPainting).not.toHaveBeenCalled()
    expect(result.current.session.painting.prompt).toBe('')
  })
  it('retains the editor on save failure and permits retry', async () => {
    const { result } = renderList()
    updatePainting.mockRejectedValueOnce(new Error('Save failed'))
    await act(async () => {
      await result.current.add()
    })
    expect(result.current.session.painting.id).toBe('current')
    await act(async () => {
      await result.current.add()
    })
    expect(result.current.session.painting.prompt).toBe('')
  })
  it.each(['prompt', 'attachments'] as const)('retains newer %s edits made while saving', async (kind) => {
    const { result } = renderList()
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add()
    })
    act(() => {
      if (kind === 'prompt') result.current.session.edit({ prompt: 'Newer edit' })
      else result.current.session.touch()
    })
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.id).toBe('current')
    await act(async () => {
      await result.current.add()
    })
    expect(updatePainting).toHaveBeenLastCalledWith('current', {
      prompt: kind === 'prompt' ? 'Newer edit' : 'Revised prompt'
    })
    expect(result.current.session.painting.prompt).toBe('')
  })
  it('allows New when generation materializes inputs and creates a new record during saving', async () => {
    const { result } = renderList()
    const applyGeneration = result.current.session.bindGeneration()
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add()
    })
    act(() => {
      applyGeneration(
        makePainting({
          id: 'generated',
          prompt: 'Original generation snapshot',
          inputFiles: [{ id: 'input' } as NonNullable<PaintingData['inputFiles']>[number]],
          generationStatus: 'running'
        })
      )
    })
    expect(result.current.session.sessionId).toBe(0)
    await act(async () => {
      finish()
      await pending
    })
    const draft = result.current.session.painting
    expect(draft.prompt).toBe('')
    expect(updatePainting).toHaveBeenLastCalledWith('generated', { prompt: 'Revised prompt' })
    act(() => {
      applyGeneration(makePainting({ id: 'generated', files: [{ id: 'output' } as PaintingData['files'][number]] }))
    })
    expect(result.current.session.painting).toBe(draft)
  })
  it('generation updates preserve newer prompt and parameter edits in the same session', () => {
    const { result } = renderList()
    const applyGeneration = result.current.session.bindGeneration()
    act(() => {
      result.current.session.edit({ prompt: 'Next request', params: { size: 'new-size' } })
    })
    act(() => {
      applyGeneration(makePainting({ id: 'generated', files: [{ id: 'output' } as PaintingData['files'][number]] }))
    })
    expect(result.current.session.painting).toMatchObject({
      id: 'generated',
      prompt: 'Next request',
      params: { size: 'new-size' },
      files: [{ id: 'output' }]
    })
  })
  it('a newer selection supersedes pending New even when the first save completes last', async () => {
    const { result } = renderList()
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add()
    })
    await act(async () => {
      await result.current.select(makePainting({ id: 'selected' }))
    })
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.id).toBe('selected')
  })
  it('reselecting the current painting cancels pending New', async () => {
    const { result } = renderList()
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add()
    })
    await act(async () => {
      await result.current.select(result.current.session.painting)
    })
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.id).toBe('current')
  })
  it('deletes the last record without saving it again', async () => {
    const { result, cancelGeneration } = renderList()
    await act(async () => {
      await result.current.remove(result.current.session.painting)
    })
    expect(cancelGeneration).toHaveBeenCalledWith('current')
    expect(deletePainting).toHaveBeenCalledWith('current')
    expect(updatePainting).not.toHaveBeenCalled()
    expect(result.current.session.painting.persistedAt).toBeUndefined()
  })

  it('a delayed delete refresh cannot replace a newer selection', async () => {
    const { result } = renderList()
    updatePainting.mockImplementation(async (id: string) => {
      if (id === 'current') throw new Error('NOT_FOUND: painting was deleted')
    })
    let finish!: () => void
    refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    let pending!: Promise<void>
    await act(async () => {
      pending = result.current.remove(result.current.session.painting)
    })
    await act(async () => {
      await result.current.select(makePainting({ id: 'selected' }))
    })
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.id).toBe('selected')
  })

  it('navigation discards the pending deletion without PATCHing its already deleted record', async () => {
    const { result } = renderList()
    let finish!: () => void
    deletePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    updatePainting.mockRejectedValue(new Error('NOT_FOUND: deletion committed before cache refresh'))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.remove(result.current.session.painting)
    })
    await act(async () => {
      await result.current.select(makePainting({ id: 'selected' }))
    })
    expect(result.current.session.painting.id).toBe('selected')
    expect(updatePainting).not.toHaveBeenCalled()
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.id).toBe('selected')
  })
})
