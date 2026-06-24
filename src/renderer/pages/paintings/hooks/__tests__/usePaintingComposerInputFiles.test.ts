import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileEntry } from '@shared/data/types/file/fileEntry'
import { renderHook, waitFor } from '@testing-library/react'
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
})
