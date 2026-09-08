import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingGenerationSubmit } from '../usePaintingGenerationSubmit'
import { usePaintingList } from '../usePaintingList'
import { usePaintingSession } from '../usePaintingSession'

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  generate: vi.fn(),
  validate: vi.fn()
}))
vi.mock('@renderer/hooks/usePaintings', () => ({
  usePaintings: () => ({
    createPainting: mocks.create,
    updatePainting: mocks.update,
    deletePainting: mocks.remove,
    refresh: vi.fn()
  })
}))
vi.mock('../usePaintingGenerationGuard', () => ({
  usePaintingGenerationGuard: () => ({ validateBeforeGenerate: mocks.validate })
}))
vi.mock('../usePaintingProviderRuntime', () => ({ usePaintingProviderRuntime: () => ({ provider: { id: 'openai' } }) }))
vi.mock('../../model/paintingPipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../model/paintingPipeline')>()),
  paintingGenerate: mocks.generate
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function renderEditor(persisted: boolean) {
  return renderHook(() => {
    const session = usePaintingSession(
      () =>
        ({
          id: 'original',
          providerId: 'openai',
          model: 'gpt-image-1',
          prompt: 'Request prompt',
          mode: 'generate',
          files: [],
          params: {},
          ...(persisted ? { persistedAt: '2026-01-01' } : {})
        }) as PaintingData
    )
    const submission = usePaintingGenerationSubmit({
      painting: session.painting,
      bindGeneration: session.bindGeneration,
      prepareGeneration: session.prepareGeneration,
      ensureCurrentCatalog: async () => []
    })
    const list = usePaintingList({
      setCurrentPainting: session.replace,
      captureSession: session.capture,
      beginTransition: session.beginTransition,
      historyItems: [],
      draftDefaults: { providerId: 'openai' },
      cancelGeneration: submission.cancel
    })
    return { session, ...submission, ...list }
  })
}

describe('painting persistence handoff', () => {
  it('does not prepare a generation queued behind successful deletion', async () => {
    const deletion = deferred()
    mocks.remove.mockImplementationOnce(() => deletion.promise)
    const { result } = renderEditor(true)
    let deleting!: Promise<void>
    let generating!: Promise<void>
    act(() => {
      deleting = result.current.remove(result.current.session.painting)
      generating = result.current.submit(async () => ({ entries: [], complete: true }))
    })
    await act(async () => {
      deletion.resolve()
      await deleting
      await generating
    })
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(writes).toEqual([])
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  const records = new Map<string, Record<string, unknown>>()
  const writes: Array<{ id: string; prompt?: string }> = []
  beforeEach(() => {
    vi.clearAllMocks()
    records.clear()
    writes.length = 0
    mocks.validate.mockResolvedValue({ ok: true })
    mocks.create.mockImplementation(async (dto) => {
      records.set(dto.id, { ...dto })
      writes.push({ id: dto.id, prompt: dto.prompt })
      return { createdAt: '2026-01-01' }
    })
    mocks.update.mockImplementation(async (id, dto) => {
      records.set(id, { ...records.get(id), ...dto })
      writes.push({ id, prompt: dto.prompt })
      return { createdAt: '2026-01-01' }
    })
  })

  it.each([true, false])('preserves newer edits after delayed preparation (persisted=%s)', async (persisted) => {
    const preparation = deferred()
    const provider = deferred()
    mocks.validate.mockImplementationOnce(async () => {
      await preparation.promise
      return { ok: true }
    })
    mocks.generate.mockImplementation(async ({ painting }) => {
      expect(painting.prompt).toBe('Request prompt')
      await provider.promise
      return [{ id: 'output' }]
    })
    const { result } = renderEditor(persisted)
    let generating!: Promise<void>
    act(() => {
      generating = result.current.submit(async () => ({ entries: [], complete: true }))
    })
    act(() => {
      result.current.session.edit({ prompt: 'Latest editor prompt' })
    })
    let navigating!: Promise<void>
    await act(async () => {
      navigating = result.current.add()
    })
    expect(result.current.session.painting.id).toBe('original')
    expect(writes).toEqual([])
    await act(async () => {
      preparation.resolve()
      await navigating
    })
    const recordId = writes[0].id
    expect(writes.slice(0, 2)).toEqual([
      { id: recordId, prompt: 'Request prompt' },
      { id: recordId, prompt: 'Latest editor prompt' }
    ])
    expect(records.get(recordId)?.prompt).toBe('Latest editor prompt')
    expect(result.current.session.painting.persistedAt).toBeUndefined()
    // Navigation does not wait for the paid provider run.
    await act(async () => {
      provider.resolve()
      await generating
    })
    expect(records.get(recordId)?.prompt).toBe('Latest editor prompt')
    expect(records.get(recordId)?.files).toEqual({ input: [], output: ['output'] })
  })

  it('finishes the captured save after unmount and record creation', async () => {
    const preparation = deferred()
    const provider = deferred()
    mocks.generate.mockImplementation(async () => {
      await provider.promise
      return []
    })
    const { result, unmount } = renderEditor(false)
    let generating!: Promise<void>
    act(() => {
      generating = result.current.submit(async () => {
        await preparation.promise
        return { entries: [], complete: true }
      })
    })
    act(() => {
      result.current.session.edit({ prompt: 'Before leaving page' })
    })
    const save = result.current.saveCurrent
    unmount()
    const saving = save()
    preparation.resolve()
    await saving
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(records.get(writes[0].id)?.prompt).toBe('Before leaving page')
    provider.resolve()
    await generating
  })
})
