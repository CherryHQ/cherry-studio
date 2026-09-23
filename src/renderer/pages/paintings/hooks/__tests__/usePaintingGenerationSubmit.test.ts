import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileEntry } from '@shared/data/types/file'

import type { PaintingData } from '../../model/types/paintingData'

const mockValidateBeforeGenerate = vi.hoisted(() => vi.fn())
const mockGenerate = vi.hoisted(() => vi.fn())
const mockPresentGuardFeedback = vi.hoisted(() => vi.fn())

vi.mock('../usePaintingGenerationGuard', () => ({
  usePaintingGenerationGuard: () => ({ validateBeforeGenerate: mockValidateBeforeGenerate })
}))

vi.mock('../usePaintingGeneration', () => ({
  usePaintingGeneration: ({ painting }: { painting: PaintingData }) => ({
    generate: mockGenerate,
    cancel: vi.fn(),
    generating: painting.generationStatus === 'running'
  })
}))

vi.mock('../../utils/presentPaintingGenerationGuardFeedback', () => ({
  presentPaintingGenerationGuardFeedback: mockPresentGuardFeedback
}))

vi.mock('../../errors/paintingGenerateError', () => ({ presentPaintingGenerateError: vi.fn() }))

const { usePaintingGenerationSubmit } = await import('../usePaintingGenerationSubmit')

const makePainting = (overrides: Partial<PaintingData> = {}): PaintingData =>
  ({ id: 'p1', providerId: 'openai', model: 'gpt-image-1', files: [], mode: 'generate', ...overrides }) as PaintingData

function renderSubmit(painting: PaintingData = makePainting()) {
  return renderHook(() =>
    usePaintingGenerationSubmit({
      painting,
      onPaintingChange: vi.fn(),
      ensureCurrentCatalog: vi.fn(async () => [])
    })
  )
}

describe('usePaintingGenerationSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateBeforeGenerate.mockResolvedValue({ ok: true })
    mockGenerate.mockResolvedValue(undefined)
  })

  it('runs the precondition guard before materializing anything', async () => {
    const materialize = vi.fn().mockResolvedValue({ entries: [], complete: true })
    mockValidateBeforeGenerate.mockResolvedValue({ ok: false, reason: 'model_missing' })

    const { result } = renderSubmit()
    await act(async () => {
      await result.current.submit(materialize)
    })

    expect(materialize).not.toHaveBeenCalled()
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockPresentGuardFeedback).toHaveBeenCalledWith('model_missing', undefined, 'openai')
  })

  it('aborts without generating when the input set is incomplete', async () => {
    const materialize = vi.fn().mockResolvedValue({ entries: [], complete: false })

    const { result } = renderSubmit()
    await act(async () => {
      await result.current.submit(materialize)
    })

    expect(materialize).toHaveBeenCalledTimes(1)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('ignores a second submit while one is in flight (synchronous re-entrancy guard)', async () => {
    let release!: () => void
    const materialize = vi.fn(
      () =>
        new Promise<{ entries: FileEntry[]; complete: boolean }>((resolve) => {
          release = () => resolve({ entries: [], complete: true })
        })
    )

    const { result } = renderSubmit()
    await act(async () => {
      void result.current.submit(materialize)
      void result.current.submit(materialize)
    })
    expect(materialize).toHaveBeenCalledTimes(1)

    await act(async () => {
      release()
    })
    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1))
  })

  it('refuses to submit while a generation is already running for this painting', async () => {
    const materialize = vi.fn().mockResolvedValue({ entries: [], complete: true })

    const { result } = renderSubmit(makePainting({ generationStatus: 'running' }))
    await act(async () => {
      await result.current.submit(materialize)
    })

    expect(materialize).not.toHaveBeenCalled()
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('ends preparation before the provider finishes, independently of the visible record', async () => {
    let prepared!: () => void
    let finish!: () => void
    mockGenerate.mockImplementationOnce(async (_entries, onPrepared) => {
      prepared = onPrepared
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const { result, rerender } = renderHook(
      (painting) =>
        usePaintingGenerationSubmit({
          painting,
          onPaintingChange: vi.fn(),
          ensureCurrentCatalog: async () => []
        }),
      { initialProps: makePainting() }
    )
    let pending!: Promise<void>
    await act(async () => {
      pending = result.current.submit(async () => ({ entries: [], complete: true }))
    })
    expect(result.current.preparing).toBe(true)
    act(() => {
      prepared()
    })
    rerender(makePainting({ id: 'new-draft' }))
    expect(result.current.preparing).toBe(false)
    expect(result.current.submitting).toBe(false)
    await act(async () => {
      finish()
      await pending
    })
    expect(result.current.submitting).toBe(false)
  })

  it('exposes submitting for the duration of a request', async () => {
    let release!: () => void
    const materialize = vi.fn(
      () =>
        new Promise<{ entries: FileEntry[]; complete: boolean }>((resolve) => {
          release = () => resolve({ entries: [], complete: true })
        })
    )

    const { result } = renderSubmit()
    expect(result.current.submitting).toBe(false)

    await act(async () => {
      void result.current.submit(materialize)
    })
    expect(result.current.submitting).toBe(true)

    await act(async () => {
      release()
    })
    await waitFor(() => expect(result.current.submitting).toBe(false))
  })
  it('does not send text-to-image requests when generation was disabled in model properties', async () => {
    const { result } = renderHook(() =>
      usePaintingGenerationSubmit({
        painting: makePainting(),
        onPaintingChange: vi.fn(),
        ensureCurrentCatalog: async () => [
          {
            value: 'gpt-image-1',
            label: 'Image',
            raw: {
              id: 'openai::gpt-image-1',
              providerId: 'openai',
              name: 'Image',
              capabilities: ['image-generation'],
              supportsStreaming: false,
              isEnabled: true,
              isHidden: false,
              endpointTypes: ['openai-image-edit']
            }
          }
        ]
      })
    )
    await act(async () => {
      await result.current.submit(async () => ({ entries: [], complete: true }))
    })
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})
