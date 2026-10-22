import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { ContentHashSchema } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { FileEditRead, FileWriteOutcome } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FileEditSessionManager } from '../FileEditSessionManager'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn(), on: vi.fn(() => () => {}) } }))
const path = AbsoluteFilePathSchema.parse('/notes/A.md')
const handle = { kind: 'path', path } as const
const hash = (value: string) => ContentHashSchema.parse(`sha256:${value.padEnd(64, '0').slice(0, 64)}`)
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
    if (route === 'file.edit.open')
      return {
        editId: crypto.randomUUID(),
        resourceKey: path,
        path,
        observationRoot: AbsoluteFilePathSchema.parse('/notes')
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

  it('cancel restores input with a fresh binding generation and keeps the document epoch', async () => {
    const lease = await manager.acquire(handle)
    const old = lease.getSnapshot()
    const prepared = await manager.prepareMutation([path])
    prepared.cancel()
    expect(lease.acceptEdit('b', old.documentEpoch, old.bindingEpoch)).toBe(false)
    expect(lease.acceptEdit('c')).toBe(true)
    expect(lease.getSnapshot().documentEpoch).toBe(old.documentEpoch)
  })

  it('fences an acquisition started before a mutation even after the mutation is cancelled', async () => {
    const gate = Promise.withResolvers<FileEditRead>()
    const original = vi.mocked(ipcApi.request).getMockImplementation()!
    vi.mocked(ipcApi.request).mockImplementation((route, ...args) =>
      route === 'file.edit.read' ? gate.promise : original(route, ...args)
    )
    const acquiring = manager.acquire(handle)
    const rejected = expect(acquiring).rejects.toThrow('closing')
    await vi.waitFor(() => expect(ipcApi.request).toHaveBeenCalledWith('file.edit.read', expect.anything()))
    const mutation = await manager.prepareMutation([path])
    await expect(manager.acquire(handle)).rejects.toThrow('transitioning')
    mutation.cancel()
    gate.resolve(disk)
    await rejected
    expect(manager.listRetained()).toEqual([])
    vi.mocked(ipcApi.request).mockImplementation(original)
    const fresh = await manager.acquire(handle)
    expect(fresh.acceptEdit('after mutation')).toBe(true)
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
