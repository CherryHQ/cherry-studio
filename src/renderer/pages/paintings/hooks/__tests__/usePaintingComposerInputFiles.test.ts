import { toast } from '@renderer/services/toast'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileEntry } from '@shared/data/types/file'
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

  it('seeds composer attachments from existing input files', async () => {
    const setFiles = vi.fn()

    renderHook(() =>
      usePaintingComposerInputFiles({ paintingId: 'p1', inputFiles: [makeEntry('fe-1')], files: [], setFiles })
    )

    await waitFor(() => expect(setFiles).toHaveBeenCalled())
    const seeded = setFiles.mock.calls[0][0] as ComposerAttachment[]
    expect(seeded).toHaveLength(1)
    expect(seeded[0].path).toBe('/p/fe-1.png')
  })

  it('clears attachments when the painting has no input files', () => {
    const setFiles = vi.fn()

    renderHook(() => usePaintingComposerInputFiles({ paintingId: 'p2', inputFiles: [], files: [], setFiles }))

    expect(setFiles).toHaveBeenCalledWith([])
  })

  it('materializes a newly added attachment to a FileEntry without an eager hold', async () => {
    const setFiles = vi.fn()

    const { result, rerender } = renderHook(
      (props: Parameters<typeof usePaintingComposerInputFiles>[0]) => usePaintingComposerInputFiles(props),
      {
        initialProps: {
          paintingId: 'p3',
          inputFiles: [] as FileEntry[],
          files: [] as ComposerAttachment[],
          setFiles
        }
      }
    )

    rerender({ paintingId: 'p3', inputFiles: [], files: [makeAttachment('src-new', '/tmp/new.png')], setFiles })

    // Materialization is deferred to this call (mirroring chat's send-time
    // buildFileParts); nothing is imported during the draft window.
    let entries: FileEntry[] = []
    await act(async () => {
      entries = await result.current.materializeInputs()
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('fe-new')
    expect(window.api.file.createInternalEntry).toHaveBeenCalledWith({
      source: 'path',
      path: '/tmp/new.png',
      cleanupPolicy: 'delete_when_unreferenced'
    })
  })

  // Stateful harness mirroring the provider: the SEED's `setFiles` re-renders with
  // the seeded attachments, so a cache-hit materialization reuses them.
  const renderStatefulHarness = (paintingId: string, inputFiles: FileEntry[]) =>
    renderHook(() => {
      const [files, setFiles] = useState<ComposerAttachment[]>([])
      const { materializeInputs } = usePaintingComposerInputFiles({ paintingId, inputFiles, files, setFiles })
      return { files, materializeInputs }
    })

  it('reuses seeded entries and carries a seed-failed one to the tail', async () => {
    ;(window.api.file.getPhysicalPath as ReturnType<typeof vi.fn>).mockImplementation(async ({ id }: { id: string }) =>
      id === 'fe-bad' ? Promise.reject(new Error('unresolvable')) : `/p/${id}.png`
    )

    // fe-bad fails to seed (no chip) but survives; fe-ok seeds and materializes from cache.
    const { result } = renderStatefulHarness('p-partial', [makeEntry('fe-bad'), makeEntry('fe-ok')])

    await waitFor(() => expect(result.current.files).toHaveLength(1))
    let entries: FileEntry[] = []
    await act(async () => {
      entries = await result.current.materializeInputs()
    })
    expect(entries.map((entry) => entry.id)).toEqual(['fe-ok', 'fe-bad'])
    // fe-ok came from the seed cache — no re-import.
    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
  })

  it('carries every input through when all seeds fail to resolve their path', async () => {
    ;(window.api.file.getPhysicalPath as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('blob missing'))

    const { result } = renderStatefulHarness('p-fail', [makeEntry('fe-1'), makeEntry('fe-2')])

    // Both fail to seed → no chips, but both are preserved.
    await waitFor(() => expect(window.api.file.getPhysicalPath).toHaveBeenCalledTimes(2))
    await act(async () => {
      await Promise.resolve()
    })

    let entries: FileEntry[] = []
    await act(async () => {
      entries = await result.current.materializeInputs()
    })
    // A transient read error never shrinks the input list handed to generation.
    expect(entries.map((entry) => entry.id)).toEqual(['fe-1', 'fe-2'])
    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
  })

  it('drops the chip and notifies when an attachment fails to materialize', async () => {
    ;(window.api.file.createInternalEntry as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ path }: { path: string }) =>
        path.includes('bad') ? Promise.reject(new Error('promote failed')) : makeEntry('fe-ok')
    )
    const setFiles = vi.fn()

    const { result, rerender } = renderHook(
      (props: Parameters<typeof usePaintingComposerInputFiles>[0]) => usePaintingComposerInputFiles(props),
      {
        initialProps: {
          paintingId: 'p-wb-fail',
          inputFiles: [] as FileEntry[],
          files: [] as ComposerAttachment[],
          setFiles
        }
      }
    )

    rerender({
      paintingId: 'p-wb-fail',
      inputFiles: [],
      files: [makeAttachment('src-ok', '/tmp/ok.png'), makeAttachment('src-bad', '/tmp/bad.png')],
      setFiles
    })

    let entries: FileEntry[] = []
    await act(async () => {
      entries = await result.current.materializeInputs()
    })

    // The resolved one reaches generation; the failed one does not.
    expect(entries.map((entry) => entry.id)).toEqual(['fe-ok'])

    // The failing chip is reconciled away and the user is notified.
    expect(toast.error).toHaveBeenCalled()
    const remover = setFiles.mock.calls
      .map((call) => call[0])
      .find((arg): arg is (prev: ComposerAttachment[]) => ComposerAttachment[] => typeof arg === 'function')
    expect(remover).toBeDefined()
    const remaining = remover?.([makeAttachment('src-ok', '/tmp/ok.png'), makeAttachment('src-bad', '/tmp/bad.png')])
    expect(remaining?.map((file) => file.fileTokenSourceId)).toEqual(['src-ok'])
  })
})
