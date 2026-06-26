import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePaintingComposerInputFiles } from '../usePaintingComposerInputFiles'

const makeEntry = (id: string, ext = 'png'): FileEntry =>
  ({ id, name: `${id}.${ext}`, ext, size: 100, origin: 'internal' }) as unknown as FileEntry

const makeAttachment = (sourceId: string, path: string): ComposerAttachment => ({
  fileTokenSourceId: sourceId,
  path,
  name: 'x.png',
  origin_name: 'x.png',
  ext: '.png',
  size: 100,
  type: 'image' as ComposerAttachment['type']
})

describe('usePaintingComposerInputFiles', () => {
  beforeEach(() => {
    const getPhysicalPath = vi.fn(async (params: { id: string }) => `/p/${params.id}.png`)
    const createInternalEntry = vi.fn(async (params: { path: string }) =>
      makeEntry(params.path.includes('new') ? 'fe-new' : 'fe-x')
    )
    window.api = {
      ...window.api,
      file: { ...window.api.file, getPhysicalPath, createInternalEntry }
    } as typeof window.api
  })

  it('seeds composer attachments from existing input files without reporting a change', async () => {
    const setFiles = vi.fn()
    const onInputFilesChange = vi.fn()

    renderHook(() =>
      usePaintingComposerInputFiles({
        paintingId: 'p1',
        inputFiles: [makeEntry('fe-1')],
        files: [],
        setFiles,
        onInputFilesChange
      })
    )

    await waitFor(() => expect(setFiles).toHaveBeenCalled())
    const seeded = setFiles.mock.calls[0][0] as ComposerAttachment[]
    expect(seeded).toHaveLength(1)
    expect(seeded[0].path).toBe('/p/fe-1.png')
    expect(onInputFilesChange).not.toHaveBeenCalled()
  })

  it('clears attachments and does not wipe input files when the painting has none', () => {
    const setFiles = vi.fn()
    const onInputFilesChange = vi.fn()

    renderHook(() =>
      usePaintingComposerInputFiles({ paintingId: 'p2', inputFiles: [], files: [], setFiles, onInputFilesChange })
    )

    expect(setFiles).toHaveBeenCalledWith([])
    expect(onInputFilesChange).not.toHaveBeenCalled()
  })

  it('promotes a newly added attachment to a FileEntry and reports it', async () => {
    const setFiles = vi.fn()
    const onInputFilesChange = vi.fn()

    const { rerender } = renderHook(
      (props: Parameters<typeof usePaintingComposerInputFiles>[0]) => usePaintingComposerInputFiles(props),
      {
        initialProps: {
          paintingId: 'p3',
          inputFiles: [] as FileEntry[],
          files: [] as ComposerAttachment[],
          setFiles,
          onInputFilesChange
        }
      }
    )

    rerender({
      paintingId: 'p3',
      inputFiles: [],
      files: [makeAttachment('src-new', '/tmp/new.png')],
      setFiles,
      onInputFilesChange
    })

    await waitFor(() => expect(onInputFilesChange).toHaveBeenCalled())
    const reported = onInputFilesChange.mock.calls.at(-1)?.[0] as FileEntry[]
    expect(reported).toHaveLength(1)
    expect(reported[0].id).toBe('fe-new')
    expect(window.api.file.createInternalEntry).toHaveBeenCalledWith({ source: 'path', path: '/tmp/new.png' })
  })

  // Stateful harness mirroring the provider: SEED's `setFiles` re-renders and re-fires
  // WRITEBACK, the round-trip a no-op `setFiles` would mask.
  const renderStatefulHarness = (paintingId: string, inputFiles: FileEntry[], onInputFilesChange: () => void) =>
    renderHook(() => {
      const [files, setFiles] = useState<ComposerAttachment[]>([])
      usePaintingComposerInputFiles({ paintingId, inputFiles, files, setFiles, onInputFilesChange })
      return files
    })

  it('does not wipe input files when every entry fails to resolve its physical path', async () => {
    ;(window.api.file.getPhysicalPath as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('blob missing'))
    const onInputFilesChange = vi.fn()

    const { result } = renderStatefulHarness('p-fail', [makeEntry('fe-1'), makeEntry('fe-2')], onInputFilesChange)

    // Seed resolves to no chips (both rejected), then the writeback settles.
    await waitFor(() => expect(result.current).toHaveLength(0))
    await act(async () => {
      await Promise.resolve()
    })

    // The failed entries are carried through, so the persisted list is never rewritten.
    expect(onInputFilesChange).not.toHaveBeenCalled()
  })

  it('seeds the resolvable inputs and carries a seed-failed one to the tail', async () => {
    ;(window.api.file.getPhysicalPath as ReturnType<typeof vi.fn>).mockImplementation(async ({ id }: { id: string }) =>
      id === 'fe-bad' ? Promise.reject(new Error('unresolvable')) : `/p/${id}.png`
    )
    const onInputFilesChange = vi.fn()

    // Failed entry first → only the resolvable one renders a chip, but both survive,
    // with the unresolved one reordered to the tail (documented behavior).
    const { result } = renderStatefulHarness('p-partial', [makeEntry('fe-bad'), makeEntry('fe-ok')], onInputFilesChange)

    await waitFor(() => expect(result.current).toHaveLength(1))
    await waitFor(() => expect(onInputFilesChange).toHaveBeenCalled())
    const reported = onInputFilesChange.mock.calls.at(-1)?.[0] as FileEntry[]
    expect(reported.map((entry) => entry.id)).toEqual(['fe-ok', 'fe-bad'])
  })

  it('drops the chip and notifies when a newly added attachment fails to promote', async () => {
    ;(window.api.file.createInternalEntry as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ path }: { path: string }) =>
        path.includes('bad') ? Promise.reject(new Error('promote failed')) : makeEntry('fe-ok')
    )
    const toastError = vi.fn()
    window.toast = { error: toastError } as unknown as typeof window.toast
    const setFiles = vi.fn()
    const onInputFilesChange = vi.fn()

    const { rerender } = renderHook(
      (props: Parameters<typeof usePaintingComposerInputFiles>[0]) => usePaintingComposerInputFiles(props),
      {
        initialProps: {
          paintingId: 'p-wb-fail',
          inputFiles: [] as FileEntry[],
          files: [] as ComposerAttachment[],
          setFiles,
          onInputFilesChange
        }
      }
    )

    rerender({
      paintingId: 'p-wb-fail',
      inputFiles: [],
      files: [makeAttachment('src-ok', '/tmp/ok.png'), makeAttachment('src-bad', '/tmp/bad.png')],
      setFiles,
      onInputFilesChange
    })

    // The resolved sibling reaches inputFiles; the failed one does not.
    await waitFor(() => expect(onInputFilesChange).toHaveBeenCalled())
    const reported = onInputFilesChange.mock.calls.at(-1)?.[0] as FileEntry[]
    expect(reported.map((entry) => entry.id)).toEqual(['fe-ok'])

    // The failing chip is reconciled away and the user is notified.
    expect(toastError).toHaveBeenCalled()
    const remover = setFiles.mock.calls
      .map((call) => call[0])
      .find((arg): arg is (prev: ComposerAttachment[]) => ComposerAttachment[] => typeof arg === 'function')
    expect(remover).toBeDefined()
    const remaining = remover?.([makeAttachment('src-ok', '/tmp/ok.png'), makeAttachment('src-bad', '/tmp/bad.png')])
    expect(remaining?.map((file) => file.fileTokenSourceId)).toEqual(['src-ok'])
  })
})
