import { createHash } from 'node:crypto'

import { act, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileEditSessionContext } from '@renderer/hooks/useFileEditSession'
import { ipcApi } from '@renderer/ipc'
import { FileEditSessionManager } from '@renderer/services/fileEdit/FileEditSessionManager'
import { notesMigrationLock } from '@renderer/services/notesMigrationLock'
import { ContentHashSchema } from '@shared/data/types/file'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { fileEditRequestSchemas, type FileEditRead } from '@shared/ipc/schemas/fileEdit'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { NotesMigrationHost } from '../NotesMigrationHost'

type EventHandler = (payload: any) => void
const ipcEventHandlers = vi.hoisted(() => new Map<string, EventHandler>())

vi.mock('@renderer/ipc', async () => {
  const { useEffect: useEffectInMock } = await import('react')
  return {
    ipcApi: {
      request: vi.fn(),
      on: vi.fn((event: string, handler: EventHandler) => {
        ipcEventHandlers.set(event, handler)
        return () => {
          ipcEventHandlers.delete(event)
        }
      })
    },
    useIpcOn: (event: string, handler: EventHandler) => {
      useEffectInMock(() => {
        ipcEventHandlers.set(event, handler)
        return () => {
          ipcEventHandlers.delete(event)
        }
      }, [event, handler])
    }
  }
})

const path = AbsoluteFilePathSchema.parse('/notes/A.md')
const handle = { kind: 'path', path } as const
const hash = (value: string) => ContentHashSchema.parse(`sha256:${createHash('sha256').update(value).digest('hex')}`)

function snapshot(text: string): FileEditRead {
  const data = new TextEncoder().encode(text)
  return { data, baseline: { version: { mtime: 123, size: data.length }, contentHash: hash(text) } }
}

let disk: FileEditRead
let writes: string[]
let failWrite: boolean
let holdWrite: Promise<void> | undefined
let manager: FileEditSessionManager
let relocationRequests: Array<{ route: string; input: any }>
let eventLog: string[]

function fire(event: string, payload: any) {
  const handler = ipcEventHandlers.get(event)
  if (!handler) throw new Error(`No host handler registered for ${event}`)
  handler(payload)
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  disk = snapshot('saved')
  writes = []
  failWrite = false
  holdWrite = undefined
  relocationRequests = []
  eventLog = []
  manager = new FileEditSessionManager()
  vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
    const input = args[0]
    if (typeof route === 'string' && route.startsWith('app.notes_relocation.')) {
      eventLog.push(route)
      relocationRequests.push({ route, input })
      if (route === 'app.notes_relocation.sync_state') return { migrationLocked: false }
      return undefined
    }
    if (route === 'file.edit.open') {
      const { handle: h } = fileEditRequestSchemas[route].input.parse(input)
      if (h.kind !== 'path') throw new Error('Path fixture required')
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
      eventLog.push('file.edit.write')
      disk = snapshot(content)
      return { baseline: disk.baseline, metadataRecoveryPending: false }
    }
    throw new Error(`Unexpected request ${String(route)}`)
  })
})

afterEach(() => {
  notesMigrationLock.reset()
  ipcEventHandlers.clear()
  vi.clearAllMocks()
})

function renderHost() {
  return render(createElement(FileEditSessionContext.Provider, { value: manager }, createElement(NotesMigrationHost)))
}

describe('NotesMigrationHost migration ordering', () => {
  it('keeps edits accepted before migration, locks on migration_started and acknowledges', async () => {
    renderHost()
    const lease = await manager.acquire('notes', handle)
    expect(lease.acceptEdit('draft edit')).toBe(true)
    expect(notesMigrationLock.isLocked()).toBe(false)

    act(() => fire('app.notes_relocation.migration_started', { batchId: 'b1' }))
    expect(notesMigrationLock.isLocked()).toBe(true)

    await waitFor(() =>
      expect(relocationRequests).toContainEqual({
        route: 'app.notes_relocation.migration_lock_ack',
        input: { batchId: 'b1', ok: true }
      })
    )
    lease.release()
  })

  it('flush_requested seals sessions, flushes dirty drafts over file.edit.write, then acknowledges ok', async () => {
    renderHost()
    const lease = await manager.acquire('notes', handle)
    expect(lease.acceptEdit('unsaved draft')).toBe(true)

    act(() => fire('app.notes_relocation.migration_started', { batchId: 'b1' }))
    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b2' }))

    await waitFor(() => expect(writes).toEqual(['unsaved draft']))
    await waitFor(() =>
      expect(relocationRequests).toContainEqual({
        route: 'app.notes_relocation.flush_ack',
        input: { batchId: 'b2', ok: true }
      })
    )
    // Ordering: the dirty draft must hit file.edit.write BEFORE the ok acknowledgement leaves.
    expect(eventLog.indexOf('file.edit.write')).toBeGreaterThanOrEqual(0)
    expect(eventLog.indexOf('file.edit.write')).toBeLessThan(eventLog.indexOf('app.notes_relocation.flush_ack'))
    // Sealed: new edits are refused while the migration holds the seal.
    expect(lease.acceptEdit('late edit')).toBe(false)

    act(() => fire('app.notes_relocation.migration_finished', undefined))
    await waitFor(() => expect(notesMigrationLock.isLocked()).toBe(false))
    await waitFor(() => expect(lease.getSnapshot().sealed).toBe(false))
    lease.release()
  })

  it('waits for a tracked in-flight editor mutation before sealing and flushing', async () => {
    renderHost()
    const lease = await manager.acquire('notes', handle)
    expect(lease.acceptEdit('typed')).toBe(true)

    let settlePaste!: () => void
    const paste = new Promise<void>((resolve) => {
      settlePaste = resolve
    })
    await act(async () => {
      void notesMigrationLock.trackEditorMutation(paste)
    })

    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b3' }))
    // The flush must not start while the paste is still tracked.
    await flushMicrotasks()
    expect(writes).toEqual([])
    expect(relocationRequests.find((r) => r.route === 'app.notes_relocation.flush_ack')).toBeUndefined()

    await act(async () => {
      settlePaste()
    })
    await waitFor(() => expect(writes).toEqual(['typed']))
    await waitFor(() =>
      expect(relocationRequests).toContainEqual({
        route: 'app.notes_relocation.flush_ack',
        input: { batchId: 'b3', ok: true }
      })
    )
    lease.release()
  })

  it('acknowledges failure and unseals when the flush write fails, so the migration can abort', async () => {
    renderHost()
    const lease = await manager.acquire('notes', handle)
    expect(lease.acceptEdit('doomed draft')).toBe(true)
    failWrite = true

    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b4' }))
    await waitFor(() =>
      expect(relocationRequests).toContainEqual({
        route: 'app.notes_relocation.flush_ack',
        input: { batchId: 'b4', ok: false }
      })
    )
    // prepareMutation unseals on failure: the editor is usable again after the abort.
    expect(lease.acceptEdit('after abort')).toBe(true)
    lease.release()
  })

  it('releases the seal when migration_finished arrives while the flush is still in flight', async () => {
    renderHost()
    const lease = await manager.acquire('notes', handle)
    expect(lease.acceptEdit('held draft')).toBe(true)

    let releaseWrite!: () => void
    holdWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    act(() => fire('app.notes_relocation.migration_started', { batchId: 'b1' }))
    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b1' }))
    await flushMicrotasks()
    // The write is still held: prepareMutation has not resolved.
    expect(relocationRequests.find((r) => r.route === 'app.notes_relocation.flush_ack')).toBeUndefined()

    // Main aborts on its own timeout and broadcasts migration_finished mid-prepare.
    act(() => fire('app.notes_relocation.migration_finished', undefined))
    await flushMicrotasks()
    expect(notesMigrationLock.isLocked()).toBe(true) // still locked until the seal is released

    await act(async () => {
      holdWrite = undefined
      releaseWrite()
    })
    // finish() ran on the late resolution: unsealed, invalidated, lock reset.
    await waitFor(() => expect(notesMigrationLock.isLocked()).toBe(false))
    await waitFor(() => expect(lease.getSnapshot().sealed).toBe(false))

    // No stale prepared survives: a fresh migration batch completes normally.
    act(() => fire('app.notes_relocation.migration_started', { batchId: 'b2' }))
    expect(lease.acceptEdit('second batch edit')).toBe(true)
    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b2' }))
    await waitFor(() =>
      expect(relocationRequests).toContainEqual({
        route: 'app.notes_relocation.flush_ack',
        input: { batchId: 'b2', ok: true }
      })
    )
    expect(writes).toContain('second batch edit')
    lease.release()
  })

  it('coalesces a duplicate flush_requested for the same in-flight batch into one prepareMutation', async () => {
    renderHost()
    const lease = await manager.acquire('notes', handle)
    expect(lease.acceptEdit('dup draft')).toBe(true)

    let releaseWrite!: () => void
    holdWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b1' }))
    await flushMicrotasks()
    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b1' }))

    await act(async () => {
      holdWrite = undefined
      releaseWrite()
    })
    await waitFor(() =>
      expect(
        relocationRequests.filter((r) => r.route === 'app.notes_relocation.flush_ack' && r.input.ok === true).length
      ).toBeGreaterThan(0)
    )
    // Exactly one flush write: the manager never saw a concurrent second prepareMutation.
    expect(writes).toEqual(['dup draft'])
    // And no spurious not-ok acknowledgement (a thrown second prepare would abort the migration).
    expect(
      relocationRequests.filter((r) => r.route === 'app.notes_relocation.flush_ack' && r.input.ok === false)
    ).toEqual([])
    lease.release()
  })

  it('releases a stale seal and starts fresh when a different batch id arrives mid-prepare', async () => {
    renderHost()
    const lease = await manager.acquire('notes', handle)
    expect(lease.acceptEdit('stale draft')).toBe(true)

    let releaseWrite!: () => void
    holdWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b1' }))
    await flushMicrotasks()
    act(() => fire('app.notes_relocation.flush_requested', { batchId: 'b2' }))

    await act(async () => {
      holdWrite = undefined
      releaseWrite()
    })
    // b1's prepared result is finished (unsealed), then b2 prepares fresh and acks ok.
    await waitFor(() =>
      expect(relocationRequests).toContainEqual({
        route: 'app.notes_relocation.flush_ack',
        input: { batchId: 'b2', ok: true }
      })
    )
    await waitFor(() => expect(lease.getSnapshot().sealed).toBe(true)) // sealed again under b2
    expect(lease.acceptEdit('during b2 seal')).toBe(false)

    act(() => fire('app.notes_relocation.migration_finished', undefined))
    await waitFor(() => expect(notesMigrationLock.isLocked()).toBe(false))
    lease.release()
  })

  it('sync_state engages the lock when a migration is already in flight on mount', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route, ...args) => {
      if (route === 'app.notes_relocation.sync_state') {
        relocationRequests.push({ route, input: args[0] })
        return { migrationLocked: true }
      }
      return undefined
    })
    renderHost()
    await waitFor(() => expect(notesMigrationLock.isLocked()).toBe(true))
  })
})
