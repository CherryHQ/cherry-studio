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

const { usePaintingGenerationSubmit } = await import('../usePaintingGenerationSubmit')

const makePainting = (overrides: Partial<PaintingData> = {}): PaintingData =>
  ({ id: 'p1', providerId: 'openai', model: 'gpt-image-1', mode: 'generate', ...overrides }) as PaintingData

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
    // The ordering IS the contract. Materialization creates
    // `delete_when_unreferenced` FileEntries, and a guard failure returns without
    // persisting the painting — so anything created first is left zero-referenced
    // for the cleanup pass to reclaim, while the composer's cache goes on pointing
    // at it. A check that can refuse the request for free must run for free.
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

  it('materializes after the guard passes and generates with the resolved entries', async () => {
    const entries = [{ id: 'fe-1' }] as unknown as FileEntry[]
    const materialize = vi.fn().mockResolvedValue({ entries, complete: true })

    const { result } = renderSubmit()
    await act(async () => {
      await result.current.submit(materialize)
    })

    expect(materialize).toHaveBeenCalledTimes(1)
    expect(mockGenerate).toHaveBeenCalledWith(entries)
  })

  it('aborts without generating when the input set is incomplete', async () => {
    // The composer has already dropped the failed chip and toasted; generating
    // anyway would spend the request on a silently smaller input set.
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
    // Both calls in one act, so the second runs before any state-driven disable
    // could re-render — this exercises the ref, not the UI.
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
    // `generating` is data-derived and can be set by a run this component never
    // started (a resumed generation rehydrates it), so it guards alongside the
    // action-scoped flag rather than being folded into it.
    const materialize = vi.fn().mockResolvedValue({ entries: [], complete: true })

    const { result } = renderSubmit(makePainting({ generationStatus: 'running' }))
    await act(async () => {
      await result.current.submit(materialize)
    })

    expect(materialize).not.toHaveBeenCalled()
    expect(mockGenerate).not.toHaveBeenCalled()
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
})
