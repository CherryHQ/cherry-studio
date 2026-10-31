import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { ContentHashSchema } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { fileEditRequestSchemas, type FileEditRead } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FileEditSessionManager } from '../FileEditSessionManager'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn(), on: vi.fn(() => () => {}) } }))
const path = AbsoluteFilePathSchema.parse('/notes/A.md')
const handle = { kind: 'path', path } as const
const hash = (value: string) => ContentHashSchema.parse(`sha256:${createHash('sha256').update(value).digest('hex')}`)
let disk: FileEditRead
let manager: FileEditSessionManager
let writes: string[]
let failWrite: boolean
let holdWrite: Promise<void> | undefined

beforeEach(() => {
  vi.useFakeTimers()
  disk = snapshot('a')
  writes = []
  failWrite = false
  holdWrite = undefined
  manager = new FileEditSessionManager()
  vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
    const input = args[0]
    if (route === 'file.edit.open') {
      const { handle } = fileEditRequestSchemas[route].input.parse(input)
      if (handle.kind !== 'path') throw new Error('Path fixture required')
      return { editId: crypto.randomUUID() }
    }
    if (route === 'file.edit.read') return disk
    if (route === 'file.edit.close') return undefined
    if (route === 'file.edit.write' && input && typeof input === 'object' && 'expected' in input && 'data' in input) {
      await holdWrite
      const content = new TextDecoder().decode(input.data)
      if (failWrite) throw new IpcError(fileErrorCodes.EDIT_NO_SPACE, 'File save failed')
      if (input.expected.contentHash !== disk.baseline.contentHash) {
        throw new IpcError(fileErrorCodes.STALE_VERSION, 'File changed since the editing baseline')
      }
      writes.push(content)
      disk = snapshot(content)
      return { baseline: disk.baseline, metadataRecoveryPending: false }
    }
    throw new Error(`Unexpected request ${route}`)
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

function snapshot(text: string): FileEditRead {
  const data = new TextEncoder().encode(text)
  return { data, baseline: { version: { mtime: 123, size: data.length }, contentHash: hash(text) } }
}

describe('file editing lifetime', () => {
  it('retains a failed draft after release and rejects callbacks from the previous attachment', async () => {
    const first = await manager.acquire('notes', handle)
    failWrite = true
    first.acceptEdit('b')
    await expect(first.flush()).rejects.toThrow()
    first.release()
    const next = await manager.acquire('notes', handle)
    expect(next.getSnapshot().draft).toBe('b')
    expect(first.acceptEdit('stale')).toBe(false)
    failWrite = false
    await next.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('b')
  })

  it('keeps different owners editable and reports a conflict without losing either draft', async () => {
    const [first, second] = await Promise.all([manager.acquire('notes', handle), manager.acquire('artifact', handle)])
    expect(first.writable).toBe(true)
    expect(second.writable).toBe(true)
    first.acceptEdit('notes edit')
    second.acceptEdit('artifact edit')
    expect(first.getSnapshot().draft).toBe('notes edit')
    expect(second.getSnapshot().draft).toBe('artifact edit')
    await first.flush()
    await expect(second.flush()).rejects.toThrow('external changes')
    expect(second.getSnapshot()).toMatchObject({ draft: 'artifact edit', conflict: true, isDirty: true })
    expect(new TextDecoder().decode(disk.data)).toBe('notes edit')
  })

  it('joins same-owner acquisitions and retires a replaced binding', async () => {
    const [first, second] = await Promise.all([manager.acquire('notes', handle), manager.acquire('notes', handle)])
    expect(first.getSnapshot().sessionId).toBe(second.getSnapshot().sessionId)
    expect(first.acceptEdit('stale')).toBe(false)
    expect(second.acceptEdit('current')).toBe(true)
    await second.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('current')
  })

  it('flush pins the undo revision behind an older write even when that undo initially looks clean', async () => {
    const lease = await manager.acquire('notes', handle)
    const gate = Promise.withResolvers<void>()
    holdWrite = gate.promise
    lease.acceptEdit('b')
    const first = lease.flush()
    await Promise.resolve()
    lease.acceptEdit('a')
    const undo = lease.flush()
    lease.acceptEdit('c')
    gate.resolve()
    await Promise.all([first, undo])
    expect(writes).toEqual(['b', 'a'])
    expect(new TextDecoder().decode(disk.data)).toBe('a')
    expect(lease.getSnapshot()).toMatchObject({ draft: 'c', isDirty: true })
    await lease.flush()
    expect(writes).toEqual(['b', 'a', 'c'])
  })

  it('holds edits until an explicit flush while autosave is off, and saves pending edits when it turns back on', async () => {
    const lease = await manager.acquire('artifact', handle)
    lease.setAutoSave(false)
    lease.acceptEdit('b')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writes).toEqual([])
    expect(lease.getSnapshot()).toMatchObject({ draft: 'b', isDirty: true })

    await lease.flush()
    expect(writes).toEqual(['b'])

    lease.acceptEdit('c')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writes).toEqual(['b'])
    lease.setAutoSave(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(writes).toEqual(['b', 'c'])
  })

  it('treats a committed write whose reply was lost as saved on the next flush', async () => {
    const lease = await manager.acquire('notes', handle)
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    vi.mocked(ipcApi.request).mockImplementationOnce(async (route, ...args) => {
      await original(route, ...args)
      throw new Error('reply lost')
    })
    lease.acceptEdit('b')
    await expect(lease.flush()).rejects.toThrow('reply lost')
    await lease.flush()
    expect(writes).toEqual(['b'])
    expect(lease.getSnapshot()).toMatchObject({ savedContent: 'b', isDirty: false, conflict: false })
  })

  it('preserves the draft on an external change and only replaces it on explicit reload', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('b')
    disk = snapshot('c')
    await lease.invalidate()
    expect(lease.getSnapshot()).toMatchObject({ conflict: true, draft: 'b', documentEpoch: 1 })
    await expect(lease.flush()).rejects.toThrow()
    await lease.reload()
    expect(lease.getSnapshot()).toMatchObject({ conflict: false, draft: 'c', documentEpoch: 2, isDirty: false })
    expect(writes).toEqual([])
  })

  it('rejects a delayed clean read after a local edit and reports the conflict on save', async () => {
    const lease = await manager.acquire('notes', handle)
    const read = Promise.withResolvers<FileEditRead>()
    vi.mocked(ipcApi.request).mockImplementationOnce(() => read.promise)
    const refreshing = lease.invalidate()
    lease.acceptEdit('local edit')
    disk = snapshot('external edit')
    read.resolve(disk)
    await refreshing
    expect(lease.getSnapshot()).toMatchObject({ draft: 'local edit', savedContent: 'a', isDirty: true })
    await expect(lease.flush()).rejects.toThrow('external changes')
    expect(lease.getSnapshot()).toMatchObject({ draft: 'local edit', conflict: true })
    expect(new TextDecoder().decode(disk.data)).toBe('external edit')
  })

  it.each(['autosave', 'release'] as const)('continues %s after an observation read recovers', async (action) => {
    const lease = await manager.acquire('notes', handle)
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    vi.mocked(ipcApi.request).mockImplementationOnce(async () => {
      throw new Error('temporary read failure')
    })
    await lease.invalidate()
    expect(lease.getSnapshot().freshness).toBe('unknown')
    vi.mocked(ipcApi.request).mockImplementation(original)
    await lease.invalidate()
    expect(lease.getSnapshot().saveError).toBeUndefined()
    lease.acceptEdit('recovered edit')
    if (action === 'release') lease.release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(new TextDecoder().decode(disk.data)).toBe('recovered edit')
    if (action === 'autosave') lease.release()
    await vi.waitFor(() => expect(manager.listRetained()).toEqual([]))
  })

  it('keeps a genuine write error through failed and successful observation reads', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('unsaved')
    failWrite = true
    await expect(lease.flush()).rejects.toThrow('File save failed')
    const writeError = lease.getSnapshot().saveError
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    vi.mocked(ipcApi.request).mockImplementationOnce(async () => {
      throw new Error('temporary read failure')
    })
    await lease.invalidate()
    vi.mocked(ipcApi.request).mockImplementation(original)
    await lease.invalidate()
    expect(lease.getSnapshot().saveError).toBe(writeError)
    failWrite = false
    lease.acceptEdit('still needs retry')
    await vi.advanceTimersByTimeAsync(1000)
    expect(new TextDecoder().decode(disk.data)).toBe('a')
    await lease.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('still needs retry')
    lease.release()
  })

  it('reconciles an invalidation received after commit but before the save receipt returns', async () => {
    const lease = await manager.acquire('notes', handle)
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
      const result = await original(route, ...args)
      if (route === 'file.edit.write') {
        disk = snapshot('c')
        await lease.invalidate()
      }
      return result
    })
    lease.acceptEdit('b')
    await lease.flush()
    await vi.waitFor(() => expect(lease.getSnapshot().draft).toBe('c'))
    expect(writes).toEqual(['b'])
    expect(lease.getSnapshot().isDirty).toBe(false)
  })

  it('discards against the baseline established by an already accepted save', async () => {
    const lease = await manager.acquire('notes', handle)
    const gate = Promise.withResolvers<void>()
    holdWrite = gate.promise
    lease.acceptEdit('b')
    const saved = lease.flush()
    lease.acceptEdit('c')
    const discarded = lease.discard()
    expect(lease.acceptEdit('d')).toBe(false)
    gate.resolve()
    await Promise.all([saved, discarded])
    expect(lease.getSnapshot()).toMatchObject({ draft: 'b', isDirty: false })
    expect(writes).toEqual(['b'])
  })

  it('flushes the window before mutation and retires callbacks even when the operation is cancelled', async () => {
    const lease = await manager.acquire('notes', handle)
    const old = lease.getSnapshot()
    lease.acceptEdit('b')
    const prepared = await manager.prepareMutation()
    expect(new TextDecoder().decode(disk.data)).toBe('b')
    expect(lease.acceptEdit('during mutation')).toBe(false)
    await prepared.finish()
    expect(lease.acceptEdit('stale', old.documentEpoch, old.bindingEpoch)).toBe(false)
    expect(lease.acceptEdit('current')).toBe(true)
    expect(lease.getSnapshot().documentEpoch).toBe(old.documentEpoch)
  })

  it('keeps a disappeared target non-writable and releases waiting acquisitions after a partial mutation', async () => {
    const lease = await manager.acquire('notes', handle)
    const prepared = await manager.prepareMutation()
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    vi.mocked(ipcApi.request).mockImplementationOnce(async () => {
      throw new Error('missing after move')
    })
    const waiting = manager.acquire('artifact', handle)
    await prepared.finish()
    expect(lease.getSnapshot()).toMatchObject({ sealed: false, readError: expect.any(Error) })
    expect(lease.acceptEdit('wrong target')).toBe(false)
    vi.mocked(ipcApi.request).mockImplementation(original)
    const next = await waiting
    expect(next.acceptEdit('new instance')).toBe(true)
    await next.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('new instance')
  })

  it('retries an acquisition interrupted by a mutation without publishing its stale read', async () => {
    const reading = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<FileEditRead>()
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    let firstRead = true
    vi.mocked(ipcApi.request).mockImplementation((route, ...args) => {
      if (route === 'file.edit.read' && firstRead) {
        firstRead = false
        reading.resolve()
        return gate.promise
      }
      return original(route, ...args)
    })
    const acquiring = manager.acquire('notes', handle)
    await reading.promise
    const mutation = await manager.prepareMutation()
    await mutation.finish()
    disk = snapshot('new')
    gate.resolve(snapshot('stale'))
    const lease = await acquiring
    expect(lease.getSnapshot().draft).toBe('new')
    expect(lease.acceptEdit('after mutation')).toBe(true)
    await lease.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('after mutation')
    lease.release()
  })

  it('releases detached clean sessions after mutation settlement', async () => {
    const openLeases = new Set<string>()
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
      const result = await original(route, ...args)
      if (route === 'file.edit.open') {
        openLeases.add(fileEditRequestSchemas[route].output.parse(result).editId)
      } else if (route === 'file.edit.close') {
        openLeases.delete(fileEditRequestSchemas[route].input.parse(args[0]).editId)
      }
      return result
    })
    const lease = await manager.acquire('notes', handle)
    const mutation = await manager.prepareMutation()
    lease.release()
    expect(openLeases.size).toBe(1)
    await mutation.finish()
    await vi.waitFor(() => expect(openLeases.size).toBe(0))
    expect(manager.listRetained()).toEqual([])
  })

  it('retains a detached failed mutation for recovery and releases queued acquisitions', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('unsaved')
    const gate = Promise.withResolvers<void>()
    holdWrite = gate.promise
    failWrite = true
    const preparing = manager.prepareMutation()
    const rejected = expect(preparing).rejects.toThrow('File save failed')
    const next = manager.acquire('notes', { kind: 'path', path: AbsoluteFilePathSchema.parse('/notes/B.md') })
    const acquired = expect(next).resolves.toMatchObject({ writable: true })
    lease.release()
    gate.resolve()
    await rejected
    await acquired
    expect(manager.getSnapshot()).toEqual([
      expect.objectContaining({
        locator: path,
        draft: 'unsaved',
        isDirty: true,
        sealed: false,
        saveError: expect.any(Error)
      })
    ])
    const nextLease = await next
    nextLease.release()
    await manager.recover(lease.getSnapshot().sessionId, 'discard')
    await vi.waitFor(() => expect(manager.listRetained()).toEqual([]))
  })

  it('does not let a conflicted session block mutations or flushes of other files', async () => {
    const other = AbsoluteFilePathSchema.parse('/notes/B.md')
    const files = new Map<string, FileEditRead>([
      [path, snapshot('a')],
      [other, snapshot('b')]
    ])
    const ids = new Map<string, string>()
    vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
      const input = args[0] as Record<string, any>
      if (route === 'file.edit.open') {
        const editId = crypto.randomUUID()
        ids.set(editId, input.handle.path)
        return { editId }
      }
      const target = ids.get(input?.editId)!
      if (route === 'file.edit.read') return files.get(target)
      if (route === 'file.edit.close') return undefined
      if (route === 'file.edit.write') {
        if (input.expected.contentHash !== files.get(target)!.baseline.contentHash)
          throw new IpcError(fileErrorCodes.STALE_VERSION, 'stale')
        files.set(target, snapshot(new TextDecoder().decode(input.data)))
        return { baseline: files.get(target)!.baseline, metadataRecoveryPending: false }
      }
      throw new Error(`Unexpected request ${route}`)
    })
    const conflicted = await manager.acquire('notes', handle)
    conflicted.acceptEdit('local A')
    files.set(path, snapshot('external A'))
    await expect(conflicted.flush()).rejects.toThrow('external changes')
    conflicted.release()
    const editing = await manager.acquire('notes', { kind: 'path', path: other })
    editing.acceptEdit('B edit')

    const prepared = await manager.prepareMutation()
    await prepared.finish()

    expect(new TextDecoder().decode(files.get(other)!.data)).toBe('B edit')
    expect(new TextDecoder().decode(files.get(path)!.data)).toBe('external A')
    expect(manager.getSnapshot()).toEqual([
      expect.objectContaining({ locator: path, draft: 'local A', conflict: true })
    ])
    editing.release()
  })

  it('refuses file mutations during composition without discarding accepted text', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('b')
    manager.setComposing(true)
    await expect(manager.prepareMutation()).rejects.toThrow('transition')
    expect(lease.acceptEdit('c')).toBe(true)
    manager.setComposing(false)
    const prepared = await manager.prepareMutation()
    expect(new TextDecoder().decode(disk.data)).toBe('c')
    await prepared.finish()
  })
})

describe('owner drain (notes relocation barrier)', () => {
  it('flushes captured edits, then holds the seal against post-ack edits and acquisitions until release', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('captured before seal')
    await manager.drainOwner('notes')
    expect(new TextDecoder().decode(disk.data)).toBe('captured before seal')

    // The window between the flush acknowledgement and the filesystem move is closed.
    expect(lease.acceptEdit('post-ack edit')).toBe(false)
    expect(lease.getSnapshot().sealed).toBe(true)
    let acquired = false
    const waiting = manager
      .acquire('notes', { kind: 'path', path: AbsoluteFilePathSchema.parse('/notes/B.md') })
      .then((next) => {
        acquired = true
        return next
      })
    await Promise.resolve()
    await Promise.resolve()
    expect(acquired).toBe(false)

    manager.releaseOwner('notes')
    expect(lease.getSnapshot().sealed).toBe(false)
    expect(lease.acceptEdit('after release')).toBe(true)
    await lease.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('after release')
    const next = await waiting
    expect(acquired).toBe(true)
    next.release()
    lease.release()
  })

  it('leaves other owners editable and writable while notes are sealed', async () => {
    const artifactPath = AbsoluteFilePathSchema.parse('/artifact/B.md')
    const files = new Map<string, FileEditRead>([
      [path, snapshot('notes base')],
      [artifactPath, snapshot('artifact base')]
    ])
    const ids = new Map<string, string>()
    vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
      const input = args[0] as Record<string, any>
      if (route === 'file.edit.open') {
        const editId = crypto.randomUUID()
        ids.set(editId, input.handle.path)
        return { editId }
      }
      const target = ids.get(input?.editId)!
      if (route === 'file.edit.read') return files.get(target)
      if (route === 'file.edit.close') return undefined
      if (route === 'file.edit.write') {
        if (input.expected.contentHash !== files.get(target)!.baseline.contentHash)
          throw new IpcError(fileErrorCodes.STALE_VERSION, 'stale')
        files.set(target, snapshot(new TextDecoder().decode(input.data)))
        return { baseline: files.get(target)!.baseline, metadataRecoveryPending: false }
      }
      throw new Error(`Unexpected request ${route}`)
    })
    const notesLease = await manager.acquire('notes', handle)
    const artifactLease = await manager.acquire('artifact', { kind: 'path', path: artifactPath })
    notesLease.acceptEdit('notes edit')
    artifactLease.acceptEdit('artifact edit')

    await manager.drainOwner('notes')

    expect(new TextDecoder().decode(files.get(path)!.data)).toBe('notes edit')
    expect(new TextDecoder().decode(files.get(artifactPath)!.data)).toBe('artifact base')
    expect(artifactLease.getSnapshot().sealed).toBe(false)
    expect(artifactLease.acceptEdit('more artifact edits')).toBe(true)
    await artifactLease.flush()
    expect(new TextDecoder().decode(files.get(artifactPath)!.data)).toBe('more artifact edits')

    manager.releaseOwner('notes')
    notesLease.release()
    artifactLease.release()
  })

  it('retries a retained failed draft through the drain and clears it once the write recovers', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('departing draft')
    failWrite = true
    await expect(lease.flush()).rejects.toThrow('File save failed')
    lease.release()
    failWrite = false

    await manager.drainOwner('notes')
    expect(new TextDecoder().decode(disk.data)).toBe('departing draft')
    manager.releaseOwner('notes')
    expect(manager.listRetained()).toEqual([])
  })

  it('rejects the drain on a conflicted retained session and keeps the draft sealed for recovery', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('local draft')
    disk = snapshot('external change')
    await expect(lease.flush()).rejects.toThrow('external changes')
    lease.release()

    await expect(manager.drainOwner('notes')).rejects.toThrow('external changes')
    expect(manager.listRetained()).toEqual([
      expect.objectContaining({ draft: 'local draft', conflict: true, sealed: true })
    ])

    manager.releaseOwner('notes')
    expect(manager.listRetained()).toEqual([
      expect.objectContaining({ draft: 'local draft', conflict: true, sealed: false })
    ])
    await manager.recover(lease.getSnapshot().sessionId, 'discard')
    expect(manager.listRetained()).toEqual([])
  })

  it('rejects the drain on a persistent save failure and ignores recovery while sealed', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('unsaved')
    failWrite = true
    await expect(lease.flush()).rejects.toThrow('File save failed')
    lease.release()

    await expect(manager.drainOwner('notes')).rejects.toThrow('File save failed')
    const retained = manager.listRetained()
    expect(retained).toEqual([expect.objectContaining({ draft: 'unsaved', saveError: expect.any(Error) })])

    await manager.recover(retained[0].sessionId, 'discard')
    expect(manager.listRetained()).toHaveLength(1)

    manager.releaseOwner('notes')
    await manager.recover(retained[0].sessionId, 'discard')
    expect(manager.listRetained()).toEqual([])
    failWrite = false
  })

  it('re-drains while the seal is held (repeated flush requests) without dropping it', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('first')
    await manager.drainOwner('notes')
    await manager.drainOwner('notes')
    expect(new TextDecoder().decode(disk.data)).toBe('first')
    expect(lease.getSnapshot().sealed).toBe(true)
    manager.releaseOwner('notes')
    lease.release()
  })

  it('rejects a concurrent drain while one is running', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('b')
    const gate = Promise.withResolvers<void>()
    holdWrite = gate.promise
    const first = manager.drainOwner('notes')
    await expect(manager.drainOwner('notes')).rejects.toThrow('already running')
    gate.resolve()
    await first
    manager.releaseOwner('notes')
    lease.release()
  })

  it('cancels pending autosaves at seal and writes exactly once through the drain', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('b')
    await manager.drainOwner('notes')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writes).toEqual(['b'])
    manager.releaseOwner('notes')
    lease.release()
  })

  it('interrupts an in-flight acquisition when the seal engages and retries it after release', async () => {
    const reading = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<FileEditRead>()
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    let firstRead = true
    vi.mocked(ipcApi.request).mockImplementation((route, ...args) => {
      if (route === 'file.edit.read' && firstRead) {
        firstRead = false
        reading.resolve()
        return gate.promise
      }
      return original(route, ...args)
    })
    const acquiring = manager.acquire('notes', handle)
    await reading.promise
    await manager.drainOwner('notes')
    disk = snapshot('new')
    gate.resolve(snapshot('stale'))
    let settled = false
    void acquiring.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    manager.releaseOwner('notes')
    const lease = await acquiring
    expect(lease.getSnapshot().draft).toBe('new')
    expect(lease.acceptEdit('after release')).toBe(true)
    await lease.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('after release')
    lease.release()
  })

  it('excludes owner drains and global mutations from each other and refuses drains during composition', async () => {
    manager.setComposing(true)
    await expect(manager.drainOwner('notes')).rejects.toThrow('transition')
    manager.setComposing(false)

    await manager.drainOwner('notes')
    await expect(manager.prepareMutation()).rejects.toThrow('transition')
    manager.releaseOwner('notes')

    const prepared = await manager.prepareMutation()
    await expect(manager.drainOwner('notes')).rejects.toThrow('transition')
    await prepared.finish()

    await manager.drainOwner('notes')
    manager.releaseOwner('notes')
  })
})
