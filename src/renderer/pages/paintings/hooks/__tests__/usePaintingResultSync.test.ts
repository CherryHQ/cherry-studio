import type { FileMetadata } from '@renderer/types/file'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PaintingData } from '../../model/types/paintingData'
import { usePaintingResultSync } from '../usePaintingResultSync'

const makeFile = (id: string): FileMetadata => ({ id }) as unknown as FileMetadata

function makePainting(id: string, overrides: Partial<PaintingData> = {}): PaintingData {
  return { id, providerId: 'zhipu', mode: 'generate', prompt: '', files: [], params: {}, ...overrides }
}

type Props = Parameters<typeof usePaintingResultSync>[0]

describe('usePaintingResultSync', () => {
  it('backfills output files when the matching history item carries more than the local copy', () => {
    const current = makePainting('p1')
    const history = [makePainting('p1', { files: [makeFile('a'), makeFile('b')] })]
    const setCurrentPainting = vi.fn()

    renderHook<void, Props>((props) => usePaintingResultSync(props), {
      initialProps: { currentPainting: current, historyItems: history, setCurrentPainting }
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
    const next = setCurrentPainting.mock.calls[0][0](current) as PaintingData
    expect(next.files).toEqual(history[0].files)
  })

  it('syncs only files, preserving local edits to prompt, params and inputFiles', () => {
    const current = makePainting('p1', {
      prompt: 'edited prompt',
      params: { seed: 7 },
      inputFiles: [{ id: 'in-1' }] as unknown as PaintingData['inputFiles']
    })
    const history = [makePainting('p1', { prompt: 'stale', params: {}, files: [makeFile('a')] })]
    const setCurrentPainting = vi.fn()

    renderHook<void, Props>((props) => usePaintingResultSync(props), {
      initialProps: { currentPainting: current, historyItems: history, setCurrentPainting }
    })

    const next = setCurrentPainting.mock.calls[0][0](current) as PaintingData
    expect(next.files).toEqual(history[0].files)
    expect(next.prompt).toBe('edited prompt')
    expect(next.params).toEqual({ seed: 7 })
    expect(next.inputFiles).toBe(current.inputFiles)
  })

  it('does nothing for a fresh draft that is absent from history', () => {
    const current = makePainting('draft')
    const history = [makePainting('other', { files: [makeFile('a')] })]
    const setCurrentPainting = vi.fn()

    renderHook<void, Props>((props) => usePaintingResultSync(props), {
      initialProps: { currentPainting: current, historyItems: history, setCurrentPainting }
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
  })

  it('does nothing when history has the same file count as the local copy', () => {
    const current = makePainting('p1', { files: [makeFile('a')] })
    const history = [makePainting('p1', { files: [makeFile('a')] })]
    const setCurrentPainting = vi.fn()

    renderHook<void, Props>((props) => usePaintingResultSync(props), {
      initialProps: { currentPainting: current, historyItems: history, setCurrentPainting }
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
  })

  it('never removes local files when history lags behind (fewer files)', () => {
    const current = makePainting('p1', { files: [makeFile('a'), makeFile('b')] })
    const history = [makePainting('p1', { files: [] })]
    const setCurrentPainting = vi.fn()

    renderHook<void, Props>((props) => usePaintingResultSync(props), {
      initialProps: { currentPainting: current, historyItems: history, setCurrentPainting }
    })

    expect(setCurrentPainting).not.toHaveBeenCalled()
  })

  it('is idempotent: no further sync once the local copy has caught up', () => {
    const draft = makePainting('p1')
    const history = [makePainting('p1', { files: [makeFile('a')] })]
    const setCurrentPainting = vi.fn()

    const { rerender } = renderHook<void, Props>((props) => usePaintingResultSync(props), {
      initialProps: { currentPainting: draft, historyItems: history, setCurrentPainting }
    })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)

    // Simulate the resulting state commit: the local copy now has the files.
    const synced = makePainting('p1', { files: [makeFile('a')] })
    rerender({ currentPainting: synced, historyItems: history, setCurrentPainting })

    expect(setCurrentPainting).toHaveBeenCalledTimes(1)
  })

  it('bails out inside the updater when the freshest state already has the files (race guard)', () => {
    const current = makePainting('p1')
    const history = [makePainting('p1', { files: [makeFile('a')] })]
    const setCurrentPainting = vi.fn()

    renderHook<void, Props>((props) => usePaintingResultSync(props), {
      initialProps: { currentPainting: current, historyItems: history, setCurrentPainting }
    })

    // A concurrent applyIfVisible already merged the files before this commit.
    const alreadyMerged = makePainting('p1', { files: [makeFile('a')] })
    const result = setCurrentPainting.mock.calls[0][0](alreadyMerged)
    expect(result).toBe(alreadyMerged)
  })

  it('never clobbers a different painting that was switched to before the commit', () => {
    const current = makePainting('p1')
    const history = [makePainting('p1', { files: [makeFile('a')] })]
    const setCurrentPainting = vi.fn()

    renderHook<void, Props>((props) => usePaintingResultSync(props), {
      initialProps: { currentPainting: current, historyItems: history, setCurrentPainting }
    })

    // The visible painting switched from p1 to p2 in the same batch: p1's history
    // files must not be written into p2's `files`.
    const switchedTo = makePainting('p2')
    const result = setCurrentPainting.mock.calls[0][0](switchedTo)
    expect(result).toBe(switchedTo)
  })
})
