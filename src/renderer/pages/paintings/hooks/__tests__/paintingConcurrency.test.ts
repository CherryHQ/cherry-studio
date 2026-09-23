import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import type { FileMetadata } from '@renderer/types/file'

import type { GenerateInput } from '../../model/types/generateInput'
import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingGenerationSubmit } from '../usePaintingGenerationSubmit'

const mocks = vi.hoisted(() => ({ generate: vi.fn(), create: vi.fn(), update: vi.fn(), error: vi.fn() }))
vi.unmock('@data/hooks/useCache')
vi.mock('@renderer/hooks/usePaintings', () => ({
  usePaintings: () => ({
    createPainting: mocks.create,
    updatePainting: mocks.update,
    selectPainting: async () => {},
    refresh: async () => {}
  })
}))
vi.mock('../usePaintingProviderRuntime', () => ({ usePaintingProviderRuntime: () => ({ provider: { id: 'test' } }) }))
vi.mock('../usePaintingGenerationGuard', () => ({
  usePaintingGenerationGuard: () => ({ validateBeforeGenerate: async () => ({ ok: true }) })
}))
vi.mock('../../model/paintingPipeline', () => ({ paintingGenerate: mocks.generate }))
vi.mock('../../errors/paintingGenerateError', () => ({ presentPaintingGenerateError: mocks.error }))

function draft(id: string): PaintingData {
  return { id, providerId: 'test', model: 'test-image', prompt: id, mode: 'generate', files: [] }
}

function setup() {
  return renderHook(() => {
    const [painting, setPainting] = useState(draft('A'))
    return {
      ...usePaintingGenerationSubmit({
        painting,
        onPaintingChange: setPainting,
        ensureCurrentCatalog: async () => [
          {
            value: 'test-image',
            label: 'test',
            raw: { capabilities: ['image-generation'], inputModalities: ['image'] }
          }
        ]
      }),
      painting,
      setPainting
    }
  })
}

const materialize = async () => ({ entries: [], complete: true })

describe('independent painting generations', () => {
  const runs = new Map<string, { input: GenerateInput; finish: () => void; fail: () => void }>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: undefined })
    runs.clear()
    mocks.create.mockImplementation(async () => ({ createdAt: 1 }))
    mocks.update.mockResolvedValue({ createdAt: 1 })
    mocks.generate.mockImplementation(
      (input: GenerateInput) =>
        new Promise<FileMetadata[]>((resolve, reject) => {
          runs.set(input.painting.prompt, {
            input,
            finish: () => resolve([{ id: `file-${input.painting.prompt}` } as FileMetadata]),
            fail: () => reject(new Error('provider failed'))
          })
          input.abortController.signal.addEventListener('abort', () =>
            reject(new DOMException('Canceled', 'AbortError'))
          )
        })
    )
  })

  it('keeps B visible when A finishes preparing after navigation', async () => {
    const { result } = setup()
    let release!: () => void
    let pending!: Promise<void>
    await act(async () => {
      pending = result.current.submit(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ entries: [], complete: true })
          })
      )
    })
    act(() => result.current.setPainting(draft('B')))
    await act(async () => {
      release()
    })
    expect(result.current.painting.id).toBe('B')
    expect(runs.get('A')).toBeDefined()
    await act(async () => {
      runs.get('A')!.finish()
      await pending
    })
    expect(result.current.painting.id).toBe('B')
    expect(result.current.painting.files).toEqual([])
    expect(mocks.update).toHaveBeenCalledWith(
      runs.get('A')!.input.painting.id,
      expect.objectContaining({ stepStatus: 'completed' })
    )
  })

  it('submits B while A runs, blocks duplicate A after navigation, and preserves out-of-order results', async () => {
    const { result } = setup()
    let pendingA!: Promise<void>
    let pendingB!: Promise<void>
    await act(async () => {
      pendingA = result.current.submit(materialize)
    })
    const a = { ...result.current.painting, generationStatus: null }
    act(() => result.current.setPainting(draft('B')))
    expect(result.current.submitting).toBe(false)
    await act(async () => {
      pendingB = result.current.submit(materialize)
    })
    const b = result.current.painting
    expect(runs.size).toBe(2)

    act(() => result.current.setPainting(a))
    expect(result.current.generating).toBe(true)
    await act(async () => {
      await result.current.submit(materialize)
    })
    expect(runs.size).toBe(2)
    expect(mocks.generate).toHaveBeenCalledTimes(2)

    await act(async () => {
      runs.get('B')!.finish()
      await pendingB
    })
    expect(result.current.painting.id).toBe(a.id)
    expect(result.current.painting.files).toEqual([])
    expect(result.current.generating).toBe(true)
    expect(mocks.update).toHaveBeenCalledWith(b.id, {
      stepStatus: 'completed',
      stepError: null,
      files: { output: ['file-B'], input: [] }
    })

    await act(async () => {
      runs.get('A')!.finish()
      await pendingA
    })
    expect(result.current.painting.files.map((f) => f.id)).toEqual(['file-A'])
    expect(result.current.generating).toBe(false)
    expect(mocks.update).toHaveBeenCalledWith(a.id, {
      stepStatus: 'completed',
      stepError: null,
      files: { output: ['file-A'], input: [] }
    })
  })

  it.each(['cancel', 'failure'] as const)('isolates A %s while B is still preparing', async (outcome) => {
    const { result } = setup()
    let pendingA!: Promise<void>
    let pendingB!: Promise<void>
    let release!: () => void
    await act(async () => {
      pendingA = result.current.submit(materialize)
    })
    const a = result.current.painting
    act(() => result.current.setPainting(draft('B')))
    await act(async () => {
      pendingB = result.current.submit(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ entries: [], complete: true })
          })
      )
    })
    await act(async () => {
      if (outcome === 'cancel') result.current.cancel(a.id)
      else runs.get('A')!.fail()
      await pendingA
    })
    expect(result.current.preparing).toBe(true)
    expect(result.current.submitting).toBe(true)
    expect(result.current.painting.prompt).toBe('B')
    expect(cacheService.get(`painting.generation.${a.id}`)?.status).toBe(outcome === 'cancel' ? 'canceled' : 'failed')
    await act(async () => {
      release()
    })
    expect(runs.get('B')!.input.abortController.signal.aborted).toBe(false)
    await act(async () => {
      runs.get('B')!.finish()
      await pendingB
    })
    expect(result.current.painting.files.map((f) => f.id)).toEqual(['file-B'])
    expect(result.current.generating).toBe(false)
  })
  it('reports a backend cancellation failure while still stopping the local request', async () => {
    const { result } = setup()
    let pending!: Promise<void>
    await act(async () => {
      pending = result.current.submit(materialize)
    })
    vi.mocked(window.api.ipcApi.request).mockRejectedValueOnce(new Error('Cancellation transport unavailable'))
    await act(async () => {
      result.current.cancel(result.current.painting.id)
      await pending
    })
    expect(runs.get('A')!.input.abortController.signal.aborted).toBe(true)
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cancellation transport unavailable' }))
    expect(result.current.generating).toBe(false)
  })

  it('edits the selected output and can branch from it without replacing historical outputs', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue({ id: 'file-A', origin: 'internal', ext: 'png', size: 10 })
    const { result } = setup()
    let initial!: Promise<void>
    await act(async () => {
      initial = result.current.submit(materialize)
    })
    await act(async () => {
      runs.get('A')!.finish()
      await initial
    })
    const source = result.current.painting
    expect(source.prompt).toBe('')
    act(() => result.current.setPainting({ ...source, prompt: 'edit-one' }))
    let first!: Promise<void>
    await act(async () => {
      first = result.current.submit(materialize)
    })
    expect(runs.get('edit-one')!.input.painting).toMatchObject({
      projectId: source.id,
      parentId: source.id,
      sourceFileId: 'file-A',
      mode: 'edit',
      inputFiles: [{ id: 'file-A' }],
      files: []
    })
    act(() => result.current.setPainting({ ...source, prompt: 'edit-two' }))
    let second!: Promise<void>
    await act(async () => {
      second = result.current.submit(materialize)
    })
    expect(runs.get('edit-two')!.input.painting.parentId).toBe(source.id)
    await act(async () => {
      runs.get('edit-two')!.finish()
      await second
    })
    await act(async () => {
      runs.get('edit-one')!.finish()
      await first
    })
    expect(result.current.painting.files.map((f) => f.id)).toEqual(['file-edit-two'])
    expect(source.files.map((f) => f.id)).toEqual(['file-A'])
  })
})
