import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { ContentHashSchema } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { fileEditRequestSchemas, type FileEditRead, type FileWriteOutcome } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FileEditSessionManager } from '../FileEditSessionManager'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn(), on: vi.fn(() => () => {}) } }))
const path = AbsoluteFilePathSchema.parse('/notes/A.md')
const handle = { kind: 'path', path } as const
const hash = (value: string) => ContentHashSchema.parse(`sha256:${createHash('sha256').update(value).digest('hex')}`)
let disk: FileEditRead
let manager: FileEditSessionManager
let writes: string[]
let receipts: Map<number, FileWriteOutcome>
let failWrite: boolean
let holdWrite: Promise<void> | undefined
let failSettlement: boolean
let loseReceipt: boolean

beforeEach(() => {
  vi.useFakeTimers()
  disk = snapshot('a')
  writes = []
  receipts = new Map()
  failWrite = false
  failSettlement = false
  loseReceipt = false
  holdWrite = undefined
  manager = new FileEditSessionManager()
  vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
    const input = args[0]
    if (route === 'file.edit.open') {
      const { handle } = fileEditRequestSchemas[route].input.parse(input)
      if (handle.kind !== 'path') throw new Error('Path fixture required')
      return {
        editId: crypto.randomUUID(),
        resourceKey: handle.path,
        path: handle.path,
        observationRoot: AbsoluteFilePathSchema.parse('/notes')
      }
    }
    if (route === 'file.observe.create')
      return { observationId: crypto.randomUUID(), generation: crypto.randomUUID(), sequence: 0 }
    if (route === 'file.observe.activate') return true
    if (route === 'file.observe.dispose') return undefined
    if (route === 'file.edit.read') return disk
    if (route === 'file.edit.close') return undefined
    if (route === 'file.edit.settle_write' && input && typeof input === 'object' && 'sequence' in input) {
      if (failSettlement) throw new Error('disconnected')
      const receipt = receipts.get(input.sequence)
      if (!receipt) throw new Error('no receipt')
      return receipt
    }
    if (
      route === 'file.edit.write' &&
      input &&
      typeof input === 'object' &&
      'expected' in input &&
      'sequence' in input &&
      'data' in input
    ) {
      await holdWrite
      const content = new TextDecoder().decode(input.data)
      if (failWrite) return { kind: 'not-committed', sequence: input.sequence, code: fileErrorCodes.EDIT_NO_SPACE }
      if (input.expected.contentHash !== disk.baseline.contentHash) {
        return { kind: 'not-committed', sequence: input.sequence, code: fileErrorCodes.STALE_VERSION }
      }
      writes.push(content)
      disk = snapshot(content)
      const receipt = {
        kind: 'committed',
        sequence: input.sequence,
        baseline: disk.baseline,
        metadataRecoveryPending: false
      } as const
      receipts.set(input.sequence, receipt)
      if (loseReceipt) throw new Error('lost receipt')
      return receipt
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
    const first = await manager.acquire(handle)
    failWrite = true
    first.acceptEdit('b')
    await expect(first.flush()).rejects.toThrow()
    first.release()
    const next = await manager.acquire(handle)
    expect(next.getSnapshot().draft).toBe('b')
    expect(first.acceptEdit('stale')).toBe(false)
    failWrite = false
    await next.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('b')
  })

  it('grants only one writer for two handles resolving to the same resource', async () => {
    const [first, second] = await Promise.all([manager.acquire(handle), manager.acquire(handle)])
    expect(first.writable).toBe(true)
    expect(second.writable).toBe(false)
    expect(second.acceptEdit('b')).toBe(false)
    first.acceptEdit('c')
    expect(second.getSnapshot().draft).toBe('c')
    await first.flush()
    expect(writes).toEqual(['c'])
  })

  it('flush pins the undo revision behind an older write even when that undo initially looks clean', async () => {
    const lease = await manager.acquire(handle)
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

  it('settles a lost receipt before issuing the next sequence', async () => {
    const lease = await manager.acquire(handle)
    loseReceipt = true
    failSettlement = true
    lease.acceptEdit('b')
    await expect(lease.flush()).rejects.toThrow('disconnected')
    expect(lease.getSnapshot().outcomeUnknown).toBe(true)
    lease.acceptEdit('c')
    failSettlement = false
    await lease.flush()
    expect(writes).toEqual(['b', 'c'])
    expect(lease.getSnapshot()).toMatchObject({ savedContent: 'c', outcomeUnknown: false })
  })

  it('preserves the draft on an external change and only replaces it on explicit reload', async () => {
    const lease = await manager.acquire(handle)
    lease.acceptEdit('b')
    disk = snapshot('c')
    await lease.invalidate()
    expect(lease.getSnapshot()).toMatchObject({ conflict: true, draft: 'b', documentEpoch: 1 })
    await expect(lease.flush()).rejects.toThrow()
    await lease.reload()
    expect(lease.getSnapshot()).toMatchObject({ conflict: false, draft: 'c', documentEpoch: 2, isDirty: false })
    expect(writes).toEqual([])
  })

  it.each(['autosave', 'release'] as const)('continues %s after an observation read recovers', async (action) => {
    const lease = await manager.acquire(handle)
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
    const lease = await manager.acquire(handle)
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
    const lease = await manager.acquire(handle)
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
    const lease = await manager.acquire(handle)
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

  it('seals a file mutation until commit and rejects edits from its retired binding', async () => {
    const lease = await manager.acquire(handle)
    lease.acceptEdit('b')
    const prepared = await manager.prepareMutation([path])
    expect(new TextDecoder().decode(disk.data)).toBe('b')
    expect(lease.acceptEdit('c')).toBe(false)
    await prepared.commit()
    expect(lease.acceptEdit('d')).toBe(false)
    expect(manager.listRetained()).toEqual([])
  })

  it.each([
    [String.raw`\\server\share\note.md`, String.raw`\\server\share\renamed.md`, '', false],
    ['//server/share/note.md', '//server/share/renamed.md', '', false],
    [String.raw`\\server\share\notes`, String.raw`\\server\share\moved`, String.raw`\nested\note.md`, true],
    ['//server/share/notes/', '//server/share/moved/', 'nested/note.md', true],
    [String.raw`\\server\share`, String.raw`\\backup\share`, String.raw`\nested\note.md`, true],
    ['//server/share', '//backup/share', '/nested/note.md', true]
  ])('flushes and rebinds network mutation %s', async (source, destination, suffix, directory) => {
    const from = AbsoluteFilePathSchema.parse(source)
    const to = AbsoluteFilePathSchema.parse(destination)
    const sourceFile = AbsoluteFilePathSchema.parse(source + suffix)
    const destinationFile = AbsoluteFilePathSchema.parse(destination + suffix)
    const temp = mkdtempSync(join(tmpdir(), 'file-edit-move-'))
    const physicalFrom = join(temp, 'source')
    const physicalTo = join(temp, 'destination')
    const oldFile = directory ? join(physicalFrom, 'nested', 'note.md') : physicalFrom
    const newFile = directory ? join(physicalTo, 'nested', 'note.md') : physicalTo
    if (directory) mkdirSync(join(physicalFrom, 'nested'), { recursive: true })
    writeFileSync(oldFile, 'a')
    const files = new Map([
      [sourceFile, oldFile],
      [destinationFile, newFile]
    ])
    const leases = new Map<string, string>()
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
      if (route === 'file.edit.open') {
        const result = fileEditRequestSchemas[route].output.parse(await original(route, ...args))
        const physical = files.get(result.path)
        if (!physical) throw new Error(`Unexpected address: ${result.path}`)
        leases.set(result.editId, physical)
        return result
      }
      if (route === 'file.edit.read' || route === 'file.edit.write') {
        const input = args[0]
        if (!input || typeof input !== 'object' || !('editId' in input)) throw new Error('Missing edit ID')
        const physical = leases.get(input.editId)
        if (!physical) throw new Error('Missing file lease')
        disk = snapshot(readFileSync(physical, 'utf8'))
        const result = await original(route, ...args)
        if (route === 'file.edit.write') writeFileSync(physical, disk.data)
        return result
      }
      return original(route, ...args)
    })
    try {
      const lease = await manager.acquire({ kind: 'path', path: sourceFile })
      lease.acceptEdit('edited before rename')
      const prepared = await manager.prepareMutation([from])
      expect(readFileSync(oldFile, 'utf8')).toBe('edited before rename')
      expect(lease.acceptEdit('during rename')).toBe(false)
      renameSync(physicalFrom, physicalTo)
      await prepared.commit({ from, to })
      expect(lease.getSnapshot()).toMatchObject({ resourceKey: destinationFile, isDirty: false, sealed: false })
      expect(lease.acceptEdit('stale source callback')).toBe(false)
      lease.release()
      const next = await manager.acquire({ kind: 'path', path: destinationFile })
      expect(next.getSnapshot().draft).toBe('edited before rename')
      expect(next.acceptEdit('edited after rename')).toBe(true)
      await next.flush()
      expect(readFileSync(newFile, 'utf8')).toBe('edited after rename')
      expect(existsSync(oldFile)).toBe(false)
      next.release()
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it.each([
    [String.raw`\\server\share\notes`, String.raw`\\server\share\notes-other\note.md`],
    ['//server/share/notes', '//server/share/notes-other/note.md'],
    ['//server/share/notes', '/server/share/notes/note.md'],
    [String.raw`\\server\share\notes`, String.raw`\\server\other\notes\note.md`],
    ['//server/share/notes', '//server/share/notes/../other/note.md']
  ])('does not include unrelated network sibling %s -> %s', async (root, sibling) => {
    const lease = await manager.acquire({ kind: 'path', path: AbsoluteFilePathSchema.parse(sibling) })
    lease.acceptEdit('unsaved sibling')
    const prepared = await manager.prepareMutation([AbsoluteFilePathSchema.parse(root)])
    expect(new TextDecoder().decode(disk.data)).toBe('a')
    expect(lease.getSnapshot().sealed).toBe(false)
    prepared.cancel()
    await lease.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('unsaved sibling')
    lease.release()
  })

  it('cancel restores input with a fresh binding generation and keeps the document epoch', async () => {
    const lease = await manager.acquire(handle)
    const old = lease.getSnapshot()
    const prepared = await manager.prepareMutation([path])
    prepared.cancel()
    expect(lease.acceptEdit('b', old.documentEpoch, old.bindingEpoch)).toBe(false)
    expect(lease.acceptEdit('c')).toBe(true)
    expect(lease.getSnapshot().documentEpoch).toBe(old.documentEpoch)
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
    const acquiring = manager.acquire(handle)
    await reading.promise
    const mutation = await manager.prepareMutation([path])
    mutation.cancel()
    disk = snapshot('new')
    gate.resolve(snapshot('stale'))
    const lease = await acquiring
    expect(lease.getSnapshot().draft).toBe('new')
    expect(lease.acceptEdit('after mutation')).toBe(true)
    await lease.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('after mutation')
    lease.release()
  })

  it.each(['cancel', 'move'] as const)('releases detached clean sessions after mutation %s', async (outcome) => {
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
    const lease = await manager.acquire(handle)
    const mutation = await manager.prepareMutation([path])
    lease.release()
    expect(openLeases.size).toBe(1)
    if (outcome === 'cancel') mutation.cancel()
    else await mutation.commit({ from: path, to: AbsoluteFilePathSchema.parse('/notes/moved.md') })
    await vi.waitFor(() => expect(openLeases.size).toBe(0))
    expect(manager.listRetained()).toEqual([])
  })

  it('retains a detached failed mutation for recovery and releases queued acquisitions', async () => {
    const lease = await manager.acquire(handle)
    lease.acceptEdit('unsaved')
    const gate = Promise.withResolvers<void>()
    holdWrite = gate.promise
    failWrite = true
    const preparing = manager.prepareMutation([path])
    const rejected = expect(preparing).rejects.toThrow('File save failed')
    const next = manager.acquire({ kind: 'path', path: AbsoluteFilePathSchema.parse('/notes/B.md') })
    const acquired = expect(next).resolves.toMatchObject({ writable: true })
    lease.release()
    gate.resolve()
    await rejected
    await acquired
    expect(manager.getSnapshot()).toEqual([
      expect.objectContaining({
        resourceKey: path,
        draft: 'unsaved',
        isDirty: true,
        sealed: false,
        saveError: expect.any(Error)
      })
    ])
    const nextLease = await next
    nextLease.release()
    await manager.recover(path, 'discard')
    await vi.waitFor(() => expect(manager.listRetained()).toEqual([]))
  })

  it('unblocks acquisitions after a failed move while retaining its detached source for recovery', async () => {
    const lease = await manager.acquire(handle)
    const mutation = await manager.prepareMutation([path])
    lease.release()
    disk = snapshot('changed destination')
    const next = manager.acquire({ kind: 'path', path: AbsoluteFilePathSchema.parse('/notes/B.md') })
    await expect(mutation.commit({ from: path, to: AbsoluteFilePathSchema.parse('/notes/moved.md') })).rejects.toThrow(
      'Moved file content changed'
    )
    const nextLease = await next
    expect(nextLease.getSnapshot().draft).toBe('changed destination')
    expect(manager.getSnapshot()).toEqual([
      expect.objectContaining({ resourceKey: path, draft: 'a', sealed: false, saveError: expect.any(Error) })
    ])
    nextLease.release()
    await manager.recover(path, 'discard')
    await vi.waitFor(() => expect(manager.listRetained()).toEqual([]))
  })

  it('refuses file mutations during composition without discarding accepted text', async () => {
    const lease = await manager.acquire(handle)
    lease.acceptEdit('b')
    manager.setComposing(true)
    await expect(manager.prepareMutation([path])).rejects.toThrow('transition')
    expect(lease.acceptEdit('c')).toBe(true)
    manager.setComposing(false)
    const prepared = await manager.prepareMutation([path])
    expect(new TextDecoder().decode(disk.data)).toBe('c')
    prepared.cancel()
  })
})
