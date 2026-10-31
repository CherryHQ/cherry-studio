import { createHash } from 'node:crypto'

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  areNotesEditsLockedForRelocation,
  registerNotesEditFlush,
  resetNotesEditFlushTrackingForTests,
  unlockNotesEditsForRelocation
} from '@renderer/hooks/notesFileEditFlush'
import { FileEditSessionContext } from '@renderer/hooks/useFileEditSession'
import { FileEditSessionManager } from '@renderer/services/fileEdit/FileEditSessionManager'
import { ContentHashSchema } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { fileEditRequestSchemas, type FileEditRead } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { NotesRelocationFlushListener } from '../NotesRelocationFlushListener'

vi.mock('@renderer/components/notes/NotesFileEditSessionProvider', () => ({ NOTES_FILE_EDIT_OWNER_ID: 'notes' }))

const { ipc, ipcHandlers } = vi.hoisted(() => ({
  ipc: { request: vi.fn(), on: vi.fn(() => () => {}) },
  ipcHandlers: new Map<string, (payload: unknown) => unknown>()
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: ipc,
  useIpcOn: (event: string, handler: (payload: unknown) => unknown) => {
    ipcHandlers.set(event, handler)
  }
}))

const path = AbsoluteFilePathSchema.parse('/notes/A.md')
const handle = { kind: 'path', path } as const
const hash = (value: string) => ContentHashSchema.parse(`sha256:${createHash('sha256').update(value).digest('hex')}`)

let disk: FileEditRead
let manager: FileEditSessionManager
let writes: string[]
let failWrite: boolean
let holdWrite: Promise<void> | undefined
let writeEntered: (() => void) | undefined
let pendingFlag: boolean
let ackCalls: Array<{ requestId: string; ok: boolean }>
let pendingCallCount: number
let pendingFailuresFromCall: number

function snapshot(text: string): FileEditRead {
  const data = new TextEncoder().encode(text)
  return { data, baseline: { version: { mtime: 123, size: data.length }, contentHash: hash(text) } }
}

beforeEach(() => {
  vi.useFakeTimers()
  disk = snapshot('a')
  writes = []
  failWrite = false
  holdWrite = undefined
  writeEntered = undefined
  pendingFlag = true
  ackCalls = []
  pendingCallCount = 0
  pendingFailuresFromCall = Number.POSITIVE_INFINITY
  manager = new FileEditSessionManager()
  ipcHandlers.clear()
  resetNotesEditFlushTrackingForTests()
  unlockNotesEditsForRelocation()
  // Mirror NotesFileEditSessionProvider: the drain reaches this window's manager.
  registerNotesEditFlush(() => manager.drainOwner('notes'))

  ipc.request.mockImplementation(async (route: string, ...args: unknown[]) => {
    const input = args[0] as Record<string, never> | undefined
    if (route === 'app.notes_relocation.flush_edits_register') return { barrierActive: false }
    if (route === 'app.notes_relocation.flush_edits_unregister') return undefined
    if (route === 'app.notes_relocation.flush_edits_pending') {
      pendingCallCount += 1
      if (pendingCallCount >= pendingFailuresFromCall) throw new IpcError('IPC_GONE', 'ipc gone')
      return { pending: pendingFlag }
    }
    if (route === 'app.notes_relocation.flush_edits_ack') {
      ackCalls.push(input as unknown as { requestId: string; ok: boolean })
      return undefined
    }
    if (route === 'file.edit.open') {
      const parsed = fileEditRequestSchemas[route].input.parse(input)
      if (parsed.handle.kind !== 'path') throw new Error('Path fixture required')
      return { editId: crypto.randomUUID() }
    }
    if (route === 'file.edit.read') return disk
    if (route === 'file.edit.close') return undefined
    if (route === 'file.edit.write' && input && typeof input === 'object' && 'expected' in input && 'data' in input) {
      writeEntered?.()
      await holdWrite
      const body = input as unknown as { expected: { contentHash: string }; data: Uint8Array }
      const content = new TextDecoder().decode(body.data)
      if (failWrite) throw new IpcError(fileErrorCodes.EDIT_NO_SPACE, 'File save failed')
      if (body.expected.contentHash !== disk.baseline.contentHash) {
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
  resetNotesEditFlushTrackingForTests()
  unlockNotesEditsForRelocation()
  vi.useRealTimers()
  vi.clearAllMocks()
})

const flushEdits = (requestId: string) =>
  ipcHandlers.get('app.notes_relocation.flush_edits')!({ requestId }) as Promise<void>
const migrateComplete = () => ipcHandlers.get('app.notes_relocation.migrate_complete')!(undefined)
const barrierEngaged = () => ipcHandlers.get('app.notes_relocation.barrier_engaged')!(undefined)

function renderListener() {
  return render(
    <FileEditSessionContext value={manager}>
      <NotesRelocationFlushListener />
    </FileEditSessionContext>
  )
}

describe('NotesRelocationFlushListener choreography (adversarial)', () => {
  it('drains, acks, then HOLDS the manager seal against post-ack edits until migrate_complete', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('draft')
    renderListener()
    await act(async () => {})

    await act(async () => {
      await flushEdits('r1')
    })

    expect(writes).toEqual(['draft'])
    expect(ackCalls).toEqual([{ requestId: 'r1', ok: true }])
    // The window between the flush ack and the filesystem move stays closed.
    expect(lease.getSnapshot().sealed).toBe(true)
    expect(lease.acceptEdit('post-ack edit')).toBe(false)
    expect(areNotesEditsLockedForRelocation()).toBe(false)

    await act(async () => {
      migrateComplete()
    })
    expect(lease.getSnapshot().sealed).toBe(false)
    expect(lease.acceptEdit('after complete')).toBe(true)
    lease.release()
  })

  it('keeps the barrier module lock after a flush ack when barrier_engaged preceded it', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('draft')
    renderListener()
    await act(async () => {})

    await act(async () => {
      barrierEngaged()
    })
    expect(areNotesEditsLockedForRelocation()).toBe(true)

    await act(async () => {
      await flushEdits('r1')
    })
    expect(ackCalls).toEqual([{ requestId: 'r1', ok: true }])
    // Only the flush-acquired lock is released; the barrier lock stays.
    expect(areNotesEditsLockedForRelocation()).toBe(true)
    expect(lease.getSnapshot().sealed).toBe(true)

    await act(async () => {
      migrateComplete()
    })
    expect(areNotesEditsLockedForRelocation()).toBe(false)
    expect(lease.getSnapshot().sealed).toBe(false)
    lease.release()
  })

  it('abort mid-drain: no stale ack, no stuck lock, no stuck seal when migrate_complete lands during the drain write', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('x')
    const gate = Promise.withResolvers<void>()
    holdWrite = gate.promise
    const writeStarted = Promise.withResolvers<void>()
    writeEntered = () => writeStarted.resolve()
    renderListener()
    await act(async () => {})

    const handler = flushEdits('r1')
    await writeStarted.promise

    // Main aborts (timeout / owner abort) while the drain's write is in flight.
    pendingFlag = false
    await act(async () => {
      migrateComplete()
    })
    gate.resolve()
    await act(async () => {
      await handler
    })

    expect(ackCalls).toEqual([])
    expect(areNotesEditsLockedForRelocation()).toBe(false)
    expect(lease.getSnapshot().sealed).toBe(false)
    expect(writes).toEqual(['x'])
    lease.release()
  })

  it('a failed drain acks ok:false, stays sealed, and the draft survives to a post-abort retry', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('bad')
    failWrite = true
    renderListener()
    await act(async () => {})

    await act(async () => {
      await flushEdits('r1')
    })

    expect(ackCalls).toEqual([{ requestId: 'r1', ok: false }])
    expect(lease.getSnapshot().sealed).toBe(true)
    expect(manager.listRetained()).toEqual([expect.objectContaining({ draft: 'bad', sealed: true })])

    failWrite = false
    await act(async () => {
      migrateComplete()
    })
    expect(lease.getSnapshot().sealed).toBe(false)
    expect(lease.getSnapshot().draft).toBe('bad')
    await act(async () => {
      await lease.flush()
    })
    expect(new TextDecoder().decode(disk.data)).toBe('bad')
    lease.release()
  })

  it('ignores a stale flush request whose pending entry is already gone without locking or draining', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('untouched')
    pendingFlag = false
    renderListener()
    await act(async () => {})

    await act(async () => {
      await flushEdits('r-stale')
    })

    expect(ackCalls).toEqual([])
    expect(writes).toEqual([])
    expect(areNotesEditsLockedForRelocation()).toBe(false)
    expect(lease.getSnapshot().sealed).toBe(false)
    lease.release()
  })

  it('an IPC failure inside the pending settled recheck no longer rejects the handler', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('draft')
    pendingFailuresFromCall = 2 // first pending check passes, the post-drain recheck throws
    renderListener()
    await act(async () => {})

    // Corrected behavior: the failure is logged and the handler resolves instead
    // of producing an unhandled rejection. The flush lock is HELD fail-closed
    // until migrate_complete clears it (and the manager seal with it).
    await act(async () => {
      await flushEdits('r1')
    })
    expect(ackCalls).toEqual([])
    expect(areNotesEditsLockedForRelocation()).toBe(true)
    expect(lease.acceptEdit('while held')).toBe(false)
    expect(lease.getSnapshot().sealed).toBe(true)
    await act(async () => {
      migrateComplete()
    })
    expect(areNotesEditsLockedForRelocation()).toBe(false)
    expect(lease.getSnapshot().sealed).toBe(false)
    expect(lease.acceptEdit('after complete')).toBe(true)
    lease.release()
  })

  it('fail-closed under a stacked barrier: a failed settled recheck leaves the barrier lock held until migrate_complete', async () => {
    const lease = await manager.acquire('notes', handle)
    lease.acceptEdit('draft')
    pendingFailuresFromCall = 2
    renderListener()
    await act(async () => {})

    await act(async () => {
      barrierEngaged()
    })
    await act(async () => {
      await flushEdits('r1')
    })
    expect(ackCalls).toEqual([])
    // The barrier lock underneath the released flush lock still blocks edits.
    expect(areNotesEditsLockedForRelocation()).toBe(true)
    expect(lease.acceptEdit('while held')).toBe(false)
    await act(async () => {
      migrateComplete()
    })
    expect(areNotesEditsLockedForRelocation()).toBe(false)
    expect(lease.getSnapshot().sealed).toBe(false)
    lease.release()
  })
})
