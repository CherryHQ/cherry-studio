import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { ContentHashSchema } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { fileEditRequestSchemas, type FileEditRead } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { FileEditSessionManager, type SessionLease } from '../FileEditSessionManager'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn(), on: vi.fn(() => () => {}) } }))
const path = AbsoluteFilePathSchema.parse('/notes/A.md')
const handle = { kind: 'path', path } as const
const hash = (value: string) => ContentHashSchema.parse(`sha256:${createHash('sha256').update(value).digest('hex')}`)
let disk: FileEditRead
let manager: FileEditSessionManager
let writes: string[]
let failWrite: boolean
let holdWrite: Promise<void> | undefined
let writeEntered: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  disk = snapshot('a')
  writes = []
  failWrite = false
  holdWrite = undefined
  writeEntered = undefined
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
      writeEntered?.()
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

describe('owner drain adversarial (abort/interleave counterexamples)', () => {
  it('abort mid-drain: releaseOwner while the drain write is in flight stays consistent and writes once', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('in flight')
    const gate = Promise.withResolvers<void>()
    holdWrite = gate.promise
    const writeStarted = Promise.withResolvers<void>()
    writeEntered = () => writeStarted.resolve()

    const drain = manager.drainOwner('notes')
    await writeStarted.promise

    // migrate_complete (abort) lands while the drain's write is still in flight.
    manager.releaseOwner('notes')
    expect(lease.getSnapshot().sealed).toBe(false)

    gate.resolve()
    await drain

    expect(writes).toEqual(['in flight'])
    expect(lease.getSnapshot()).toMatchObject({ sealed: false, isDirty: false })
    // No stuck seal: a global mutation is allowed again immediately.
    const prepared = await manager.prepareMutation()
    await prepared.finish()
    lease.release()
    expect(manager.listRetained()).toEqual([])
  })

  it('a waiting acquisition survives a second drain that starts between release and wakeup', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('x')
    await manager.drainOwner('notes')
    lease.release()

    let acquired: SessionLease | undefined
    const waiting = manager
      .acquire('notes', { kind: 'path', path: AbsoluteFilePathSchema.parse('/notes/B.md') })
      .then((next) => {
        acquired = next
        return next
      })

    // Synchronously re-seal before the waiting acquisition's continuation can run:
    // releaseOwner resolves the seal promise, but drainOwner's synchronous seal
    // creation must win the microtask race.
    manager.releaseOwner('notes')
    await manager.drainOwner('notes')
    await Promise.resolve()
    await Promise.resolve()
    expect(acquired).toBeUndefined()

    manager.releaseOwner('notes')
    const next = await waiting
    expect(acquired).toBe(next)
    // Single-disk fixture: the acquisition re-opened and read the current shared disk content.
    expect(next.getSnapshot().draft).toBe(new TextDecoder().decode(disk.data))
    next.release()
  })

  it('rejects edits carrying pre-seal epochs after a seal/release cycle while the rebound lease stays writable', async () => {
    const lease = await manager.acquire('notes', handle)
    const documentEpoch = lease.getSnapshot().documentEpoch
    const bindingEpoch = lease.getSnapshot().bindingEpoch

    await manager.drainOwner('notes')
    manager.releaseOwner('notes')

    expect(lease.acceptEdit('stale captured epochs', documentEpoch, bindingEpoch)).toBe(false)
    expect(lease.acceptEdit('current binding')).toBe(true)
    await lease.flush()
    expect(new TextDecoder().decode(disk.data)).toBe('current binding')
    lease.release()
  })

  it('ignores a retry-recovery while sealed, then honors it after release', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('unsaved')
    failWrite = true
    await expect(lease.flush()).rejects.toThrow('File save failed')
    lease.release()

    await expect(manager.drainOwner('notes')).rejects.toThrow('File save failed')
    const retained = manager.listRetained()
    expect(retained).toHaveLength(1)

    const writesBefore = writes.length
    await manager.recover(retained[0].sessionId, 'retry')
    expect(writes).toHaveLength(writesBefore)

    manager.releaseOwner('notes')
    failWrite = false
    await manager.recover(retained[0].sessionId, 'retry')
    expect(new TextDecoder().decode(disk.data)).toBe('unsaved')
    expect(manager.listRetained()).toEqual([])
  })

  it('preserves a conflicted draft across seal, abort, release and re-attach (post-ack draft preservation)', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('local draft')
    disk = snapshot('external change')
    await expect(lease.flush()).rejects.toThrow('external changes')
    lease.release()

    await expect(manager.drainOwner('notes')).rejects.toThrow('external changes')
    manager.releaseOwner('notes')

    const next = await manager.acquire('notes', handle)
    expect(next.getSnapshot()).toMatchObject({ draft: 'local draft', conflict: true, sealed: false })
    expect(next.acceptEdit('continued draft')).toBe(true)
    expect(next.getSnapshot().draft).toBe('continued draft')
    next.release()
    expect(manager.listRetained()).toEqual([expect.objectContaining({ draft: 'continued draft', conflict: true })])
  })

  it('keeps a failed drain from unsealing: re-drain retries the same retained draft after recovery of the environment', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('departing')
    failWrite = true
    await expect(manager.drainOwner('notes')).rejects.toThrow('File save failed')
    expect(lease.getSnapshot().sealed).toBe(true)
    // Environment recovers (e.g. disk space freed) while still sealed: re-drain succeeds in place.
    failWrite = false
    await manager.drainOwner('notes')
    expect(new TextDecoder().decode(disk.data)).toBe('departing')
    expect(lease.getSnapshot().sealed).toBe(true)
    manager.releaseOwner('notes')
    expect(lease.getSnapshot().sealed).toBe(false)
    lease.release()
    expect(manager.listRetained()).toEqual([])
  })
})
