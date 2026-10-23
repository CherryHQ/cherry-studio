import { createHash } from 'node:crypto'

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
      return { editId: crypto.randomUUID() }
    }
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

  it('settles a lost receipt before issuing the next sequence', async () => {
    const lease = await manager.acquire('notes', handle)
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
