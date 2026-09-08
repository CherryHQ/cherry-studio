import { dataApiService } from '@data/DataApiService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
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

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn(async (path: string) => makePainting({ id: decodeURIComponent(path.split('/').at(-1)!) }))
  }
}))
vi.mock('../../model/mappers/recordToPaintingData', () => ({
  recordToPaintingData: async (record: PaintingData) => record
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
function renderList(painting = makePainting(), historyItems = [painting]) {
  const cancelGeneration = vi.fn()
  return {
    cancelGeneration,
    ...renderHook(() => {
      const session = usePaintingSession(() => painting)
      const list = usePaintingList({
        setCurrentPainting: session.replace,
        beginTransition: session.beginTransition,
        captureSession: session.capture,
        draftDefaults: { providerId: 'openai', modelId: 'dall-e-3' },
        historyItems,
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
  it.each(['failed', 'canceled'] as const)(
    'leaves a deleted editor when its replacement navigation is %s',
    async (outcome) => {
      const { result } = renderList()
      const target = makePainting({ id: 'selected' })
      let finishDelete!: () => void
      deletePainting.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishDelete = resolve
          })
      )
      let finishRead!: () => void
      vi.mocked(dataApiService.get).mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finishRead = resolve
        })
        if (outcome === 'failed') throw new Error('IPC failed')
        return target as never
      })
      let deleting!: Promise<void>
      let selecting!: Promise<void>
      await act(async () => {
        deleting = result.current.remove(result.current.session.painting)
        selecting = result.current.select(target)
        finishDelete()
        await deleting
      })
      expect(result.current.session.painting.id).toBe('current')
      await act(async () => {
        if (outcome === 'canceled') await result.current.remove(target)
        finishRead()
        await selecting
      })
      expect(result.current.session.painting.persistedAt).toBeUndefined()
      expect(updatePainting).not.toHaveBeenCalled()
    }
  )

  beforeEach(() => {
    vi.clearAllMocks()
    updatePainting.mockReset().mockResolvedValue(undefined)
    deletePainting.mockResolvedValue(undefined)
    refresh.mockResolvedValue(undefined)
  })
  it('saves editable fields before New, leaving generated references owned by generation', async () => {
    const { result } = renderList(makePainting({ files: [{ id: 'old-output' } as PaintingData['files'][number]] }))
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add()
    })
    expect(result.current.session.painting.id).toBe('current')
    expect(updatePainting).toHaveBeenCalledWith('current', {
      prompt: 'Revised prompt',
      providerId: 'silicon',
      modelId: undefined
    })
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
  it('persists edited provider and model without writing generated files', async () => {
    const { result } = renderList()
    act(() => result.current.session.edit({ providerId: 'openai', model: 'gpt-image-1' }))
    await act(async () => {
      await result.current.saveCurrent()
    })
    expect(updatePainting).toHaveBeenCalledWith('current', {
      prompt: 'Revised prompt',
      providerId: 'openai',
      modelId: 'gpt-image-1'
    })
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
      providerId: 'silicon',
      modelId: undefined,
      prompt: kind === 'prompt' ? 'Newer edit' : 'Revised prompt'
    })
    expect(result.current.session.painting.prompt).toBe('')
  })
  it('saves the migrated record after generation preparation before New', async () => {
    const { result } = renderList()
    const apply = result.current.session.bindGeneration()
    let finish!: () => void
    const ready = new Promise<void>((resolve) => {
      finish = resolve
    })
    let preparing!: Promise<void>
    act(() => {
      preparing = result.current.session.prepareGeneration(async () => {
        await ready
        apply(makePainting({ id: 'generated', prompt: 'Old request' }))
      })
    })
    let navigating!: Promise<void>
    act(() => {
      navigating = result.current.add()
    })
    expect(updatePainting).not.toHaveBeenCalled()
    await act(async () => {
      finish()
      await preparing
      await navigating
    })
    expect(updatePainting).toHaveBeenLastCalledWith('generated', expect.objectContaining({ prompt: 'Revised prompt' }))
    expect(result.current.session.painting.persistedAt).toBeUndefined()
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
  it('a newer selection supersedes pending New after ordered saves', async () => {
    const { result } = renderList()
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add()
    })
    let selecting!: Promise<void>
    act(() => {
      selecting = result.current.select(makePainting({ id: 'selected' }))
    })
    await act(async () => {
      finish()
      await pending
      await selecting
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

  it('leaves the deleted session even if generation binds it to a new record', async () => {
    const original = makePainting()
    const { result } = renderList(original, [original, makePainting({ id: 'generated' })])
    const target = result.current.session.painting
    const applyGeneration = result.current.session.bindGeneration()
    let finish!: () => void
    deletePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.remove(target)
    })
    act(() => {
      applyGeneration(makePainting({ id: 'generated' }))
    })
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.persistedAt).toBeUndefined()
    const draft = result.current.session.painting
    act(() => {
      applyGeneration(makePainting({ id: 'generated' }))
    })
    expect(result.current.session.painting).toBe(draft)
  })

  it('does not open a selection whose target was deleted while saving', async () => {
    const { result } = renderList()
    const target = makePainting({ id: 'selected' })
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.select(target)
    })
    await act(async () => {
      await result.current.remove(target)
    })
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.id).toBe('current')
  })

  it('waits for a failed deletion and saves edits before New', async () => {
    const { result } = renderList()
    let fail!: (error: Error) => void
    deletePainting.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        })
    )
    let deleting!: Promise<void>
    let navigating!: Promise<void>
    await act(async () => {
      deleting = result.current.remove(result.current.session.painting)
      navigating = result.current.add()
    })
    expect(result.current.session.painting.id).toBe('current')
    await act(async () => {
      fail(new Error('SQLITE_BUSY'))
      await deleting
      await navigating
    })
    expect(updatePainting).toHaveBeenCalledWith('current', expect.objectContaining({ prompt: 'Revised prompt' }))
    expect(result.current.session.painting.persistedAt).toBeUndefined()
  })

  it('skips a deleted fallback even while hydrated history still contains it', async () => {
    const original = makePainting()
    const stale = makePainting({ id: 'deleted-earlier' })
    const valid = makePainting({ id: 'valid' })
    const { result } = renderList(original, [original, stale, valid])
    vi.mocked(dataApiService.get).mockRejectedValueOnce(DataApiErrorFactory.notFound('Painting', stale.id))
    await act(async () => {
      await result.current.remove(original)
    })
    expect(result.current.session.painting.id).toBe('valid')
  })

  it('retains the session on delete failure and allows retry', async () => {
    const { result } = renderList()
    const original = result.current.session.painting
    deletePainting.mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    await act(async () => {
      await result.current.remove(original)
    })
    expect(result.current.session.painting).toBe(original)
    await act(async () => {
      await result.current.saveCurrent()
    })
    expect(updatePainting).toHaveBeenCalledWith('current', expect.objectContaining({ prompt: original.prompt }))
    await act(async () => {
      await result.current.remove(original)
    })
    expect(result.current.session.painting.persistedAt).toBeUndefined()
  })

  it('rejects selection of a record while its deletion is pending', async () => {
    const { result } = renderList()
    const target = makePainting({ id: 'selected' })
    let finish!: () => void
    deletePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.remove(target)
    })
    await act(async () => {
      await result.current.select(target)
    })
    expect(result.current.session.painting.id).toBe('current')
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.id).toBe('current')
  })

  it('deleting an unrelated record does not cancel pending selection', async () => {
    const { result } = renderList()
    const finish = delaySave()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.select(makePainting({ id: 'selected' }))
    })
    await act(async () => {
      await result.current.remove(makePainting({ id: 'unrelated' }))
    })
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.session.painting.id).toBe('selected')
  })

  it.each(['select', 'new'] as const)(
    'preserves newer pending %s after generation migrates a deleting session',
    async (navigation) => {
      const { result } = renderList()
      const target = result.current.session.painting
      const applyGeneration = result.current.session.bindGeneration()
      let finishDelete!: () => void
      deletePainting.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishDelete = resolve
          })
      )
      let deleting!: Promise<void>
      act(() => {
        deleting = result.current.remove(target)
      })
      act(() => {
        applyGeneration(makePainting({ id: 'generated' }))
      })
      const finishSave = delaySave()
      let navigating!: Promise<void>
      act(() => {
        navigating =
          navigation === 'select' ? result.current.select(makePainting({ id: 'selected' })) : result.current.add()
      })
      await act(async () => {
        finishDelete()
        await deleting
      })
      expect(result.current.session.painting.id).toBe('generated')
      await act(async () => {
        finishSave()
        await navigating
      })
      if (navigation === 'select') expect(result.current.session.painting.id).toBe('selected')
      else expect(result.current.session.painting.persistedAt).toBeUndefined()
    }
  )

  it('does not use another pending deletion as the fallback selection', async () => {
    const original = makePainting()
    const other = makePainting({ id: 'other' })
    const { result } = renderList(original, [original, other])
    let finish!: () => void
    deletePainting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.remove(other)
    })
    await act(async () => {
      await result.current.remove(original)
    })
    expect(result.current.session.painting.persistedAt).toBeUndefined()
    await act(async () => {
      finish()
      await pending
    })
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
    let selecting!: Promise<void>
    await act(async () => {
      selecting = result.current.select(makePainting({ id: 'selected' }))
    })
    expect(result.current.session.painting.id).toBe('current')
    expect(updatePainting).not.toHaveBeenCalled()
    await act(async () => {
      finish()
      await pending
      await selecting
    })
    expect(result.current.session.painting.id).toBe('selected')
  })
})
