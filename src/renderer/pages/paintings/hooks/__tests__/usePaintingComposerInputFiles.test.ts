import { toast } from '@renderer/services/toast'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileEntry } from '@shared/data/types/file'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type InputCapability, usePaintingComposerInputFiles } from '../usePaintingComposerInputFiles'

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
      usePaintingComposerInputFiles({
        paintingId: 'p1',
        inputFiles: [makeEntry('fe-1')],
        files: [],
        setFiles,
        inputCapability: 'accept',
        providerId: 'openai'
      })
    )

    await waitFor(() => expect(setFiles).toHaveBeenCalled())
    const seeded = setFiles.mock.calls[0][0] as ComposerAttachment[]
    expect(seeded).toHaveLength(1)
    expect(seeded[0].path).toBe('/p/fe-1.png')
  })

  it('clears attachments when the painting has no input files', () => {
    const setFiles = vi.fn()

    renderHook(() =>
      usePaintingComposerInputFiles({
        paintingId: 'p2',
        inputFiles: [],
        files: [],
        setFiles,
        inputCapability: 'accept',
        providerId: 'openai'
      })
    )

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
          setFiles,
          inputCapability: 'accept' as const,
          providerId: 'openai'
        }
      }
    )

    rerender({
      paintingId: 'p3',
      inputFiles: [],
      files: [makeAttachment('src-new', '/tmp/new.png')],
      setFiles,
      inputCapability: 'accept',
      providerId: 'openai'
    })

    // Materialization is deferred to this call (mirroring chat's send-time
    // buildFileParts); nothing is imported during the draft window.
    let out = { entries: [] as FileEntry[], complete: false }
    await act(async () => {
      out = await result.current.materializeInputs()
    })
    expect(out.complete).toBe(true)
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0].id).toBe('fe-new')
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
      const { materializeInputs } = usePaintingComposerInputFiles({
        paintingId,
        inputFiles,
        files,
        setFiles,
        inputCapability: 'accept',
        providerId: 'openai'
      })
      return { files, materializeInputs }
    })

  it('reuses seeded entries and carries a seed-failed one to the tail', async () => {
    ;(window.api.file.getPhysicalPath as ReturnType<typeof vi.fn>).mockImplementation(async ({ id }: { id: string }) =>
      id === 'fe-bad' ? Promise.reject(new Error('unresolvable')) : `/p/${id}.png`
    )

    // fe-bad fails to seed (no chip) but survives; fe-ok seeds and materializes from cache.
    const { result } = renderStatefulHarness('p-partial', [makeEntry('fe-bad'), makeEntry('fe-ok')])

    await waitFor(() => expect(result.current.files).toHaveLength(1))
    let out = { entries: [] as FileEntry[], complete: false }
    await act(async () => {
      out = await result.current.materializeInputs()
    })
    expect(out.complete).toBe(true)
    expect(out.entries.map((entry) => entry.id)).toEqual(['fe-ok', 'fe-bad'])
    // fe-ok came from the seed cache — no re-import.
    expect(window.api.file.createInternalEntry).not.toHaveBeenCalled()
  })

  it('re-imports a cached entry that was reclaimed since it was cached', async () => {
    // A cached id is not proof the row survives. Any send ending before `generate`
    // persists the painting refs leaves materialized entries zero-referenced, and
    // the cleanup pass then reclaims them — correctly. Without a probe the cache
    // would keep handing out the dead id, which PaintingService silently drops from
    // the refs: the chip stays visible while its image vanishes from the request.
    const seeded = makeEntry('fe-gone')
    ;(window.api.file.getPhysicalPath as ReturnType<typeof vi.fn>).mockResolvedValue('/p/fe-gone.png')

    const { result } = renderStatefulHarness('p-reclaimed', [seeded])
    await waitFor(() => expect(result.current.files).toHaveLength(1))

    // The entry is reclaimed between seeding and the send: the probe now rejects.
    ;(window.api.file.getPhysicalPath as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'))
    ;(window.api.file.createInternalEntry as ReturnType<typeof vi.fn>).mockResolvedValue(makeEntry('fe-fresh'))

    let out = { entries: [] as FileEntry[], complete: false }
    await act(async () => {
      out = await result.current.materializeInputs()
    })

    // Re-imported from the attachment path rather than handed the dead id.
    expect(out.complete).toBe(true)
    expect(out.entries.map((entry) => entry.id)).toEqual(['fe-fresh'])
    expect(window.api.file.createInternalEntry).toHaveBeenCalledTimes(1)
  })

  it('carries every input through when all seeds fail to resolve their path', async () => {
    ;(window.api.file.getPhysicalPath as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('blob missing'))

    const { result } = renderStatefulHarness('p-fail', [makeEntry('fe-1'), makeEntry('fe-2')])

    // Both fail to seed → no chips, but both are preserved.
    await waitFor(() => expect(window.api.file.getPhysicalPath).toHaveBeenCalledTimes(2))
    await act(async () => {
      await Promise.resolve()
    })

    let out = { entries: [] as FileEntry[], complete: false }
    await act(async () => {
      out = await result.current.materializeInputs()
    })
    // A transient read error never shrinks the input list handed to generation.
    expect(out.complete).toBe(true)
    expect(out.entries.map((entry) => entry.id)).toEqual(['fe-1', 'fe-2'])
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
          setFiles,
          inputCapability: 'accept' as const,
          providerId: 'openai'
        }
      }
    )

    rerender({
      paintingId: 'p-wb-fail',
      inputFiles: [],
      files: [makeAttachment('src-ok', '/tmp/ok.png'), makeAttachment('src-bad', '/tmp/bad.png')],
      setFiles,
      inputCapability: 'accept',
      providerId: 'openai'
    })

    let out = { entries: [] as FileEntry[], complete: true }
    await act(async () => {
      out = await result.current.materializeInputs()
    })

    // Contract: an incomplete input set (one chip failed to promote) is reported as
    // `complete: false` so the caller aborts the send. The resolved one is still
    // returned but must go unused.
    expect(out.complete).toBe(false)
    expect(out.entries.map((entry) => entry.id)).toEqual(['fe-ok'])

    // The failing chip is reconciled away and the user is notified.
    expect(toast.error).toHaveBeenCalled()
    const remover = setFiles.mock.calls
      .map((call) => call[0])
      .find((arg): arg is (prev: ComposerAttachment[]) => ComposerAttachment[] => typeof arg === 'function')
    expect(remover).toBeDefined()
    const remaining = remover?.([makeAttachment('src-ok', '/tmp/ok.png'), makeAttachment('src-bad', '/tmp/bad.png')])
    expect(remaining?.map((file) => file.fileTokenSourceId)).toEqual(['src-ok'])
  })

  // CLEAR — a same-painting model switch does not remount, so this effect reconciles
  // switchModel's `inputFiles: []`. Stateful harness so a real setFiles drives `files`.
  interface SwitchProps {
    inputCapability: InputCapability
    providerId: string
  }
  const renderSwitchHarness = (initial: SwitchProps) =>
    renderHook(
      (props: SwitchProps) => {
        const [files, setFiles] = useState<ComposerAttachment[]>([])
        const { materializeInputs } = usePaintingComposerInputFiles({
          paintingId: 'p-switch',
          inputFiles: [],
          files,
          setFiles,
          inputCapability: props.inputCapability,
          providerId: props.providerId
        })
        return { files, setFiles, materializeInputs }
      },
      { initialProps: initial }
    )

  const attachChip = async (result: { current: { setFiles: (f: ComposerAttachment[]) => void } }) => {
    await act(async () => {
      result.current.setFiles([makeAttachment('src-draft', '/tmp/draft.png')])
    })
  }

  it('preserves the draft when switching between two edit models (accept → accept)', async () => {
    const { result, rerender } = renderSwitchHarness({ inputCapability: 'accept', providerId: 'openai' })
    await attachChip(result)
    expect(result.current.files).toHaveLength(1)

    // Same provider, still edit-capable: no clear.
    rerender({ inputCapability: 'accept', providerId: 'openai' })
    expect(result.current.files).toHaveLength(1)
  })

  it('clears the draft when switching to a model that cannot accept images (accept → reject)', async () => {
    const { result, rerender } = renderSwitchHarness({ inputCapability: 'accept', providerId: 'openai' })
    await attachChip(result)
    expect(result.current.files).toHaveLength(1)

    rerender({ inputCapability: 'reject', providerId: 'openai' })
    expect(result.current.files).toEqual([])
    // The cache is reset too, so a stale entry never leaks into the next generation.
    let out = { entries: [makeEntry('leak')] as FileEntry[], complete: false }
    await act(async () => {
      out = await result.current.materializeInputs()
    })
    expect(out.entries).toEqual([])
  })

  it('clears the draft when switching provider', async () => {
    const { result, rerender } = renderSwitchHarness({ inputCapability: 'accept', providerId: 'openai' })
    await attachChip(result)
    expect(result.current.files).toHaveLength(1)

    rerender({ inputCapability: 'accept', providerId: 'gemini' })
    expect(result.current.files).toEqual([])
  })

  it('does not clear on a load blip (accept → unknown → accept)', async () => {
    const { result, rerender } = renderSwitchHarness({ inputCapability: 'accept', providerId: 'openai' })
    await attachChip(result)

    // Model briefly unresolved during a catalog refetch, then resolves back to edit.
    rerender({ inputCapability: 'unknown', providerId: 'openai' })
    rerender({ inputCapability: 'accept', providerId: 'openai' })
    expect(result.current.files).toHaveLength(1)
  })

  it('still detects a support drop across an unknown blip (accept → unknown → reject)', async () => {
    const { result, rerender } = renderSwitchHarness({ inputCapability: 'accept', providerId: 'openai' })
    await attachChip(result)

    rerender({ inputCapability: 'unknown', providerId: 'openai' })
    rerender({ inputCapability: 'reject', providerId: 'openai' })
    expect(result.current.files).toEqual([])
  })
})
