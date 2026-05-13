/**
 * IPC handler registration tests for Phase 2 File channels.
 *
 * Verifies that `createInternalEntry`, `ensureExternalEntry`, and
 * `getPhysicalPath` channels are registered on `ipcMain.handle` and
 * that each dispatches to the corresponding FileManager method.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileManager } = await import('../FileManager')
const { danglingCache } = await import('../danglingCache')

describe('FileManager v2 IPC handler registration', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let internalRoot: string
  let fm: InstanceType<typeof FileManager>

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-ipc-v2-'))
    internalRoot = path.join(tmp, 'files-internal')
    await mkdir(internalRoot, { recursive: true })
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(internalRoot, filename) : internalRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    BaseService.resetInstances()
    danglingCache.clear()
    vi.mocked(ipcMain.handle).mockClear()
    fm = new FileManager()
    await fm.onInit()
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('registers File:createInternalEntry IPC channel', () => {
    const registeredChannels = vi.mocked(ipcMain.handle).mock.calls.map(([channel]) => channel)
    expect(registeredChannels).toContain(IpcChannel.File_CreateInternalEntry)
  })

  it('registers File:ensureExternalEntry IPC channel', () => {
    const registeredChannels = vi.mocked(ipcMain.handle).mock.calls.map(([channel]) => channel)
    expect(registeredChannels).toContain(IpcChannel.File_EnsureExternalEntry)
  })

  it('registers File:getPhysicalPath IPC channel', () => {
    const registeredChannels = vi.mocked(ipcMain.handle).mock.calls.map(([channel]) => channel)
    expect(registeredChannels).toContain(IpcChannel.File_GetPhysicalPath)
  })

  it('createInternalEntry handler creates a file from bytes and returns a FileEntry', async () => {
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === IpcChannel.File_CreateInternalEntry)?.[1]
    expect(handler).toBeDefined()

    const params = {
      source: 'bytes' as const,
      data: new Uint8Array([104, 101, 108, 108, 111]),
      name: 'hello',
      ext: 'txt'
    }
    const result = await handler!({} as never, params)

    expect(result.origin).toBe('internal')
    expect(result.name).toBe('hello')
    expect(result.ext).toBe('txt')
    expect(result.size).toBe(5)
  })

  it('ensureExternalEntry handler upserts an external entry', async () => {
    const extFile = path.join(tmp, 'external.pdf')
    await writeFile(extFile, '%PDF-1.4')

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === IpcChannel.File_EnsureExternalEntry)?.[1]
    expect(handler).toBeDefined()

    const result = await handler!({} as never, { externalPath: extFile })
    expect(result.origin).toBe('external')
    expect(result.externalPath).toBe(extFile)
    expect(result.name).toBe('external')
    expect(result.ext).toBe('pdf')

    // Idempotent — second call returns the same entry
    const result2 = await handler!({} as never, { externalPath: extFile })
    expect(result2.id).toBe(result.id)
  })

  it('getPhysicalPath handler returns the filesystem path for an internal entry', async () => {
    // First create an entry so we have a valid id
    const createHandler = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([ch]) => ch === IpcChannel.File_CreateInternalEntry)?.[1]
    const entry = await createHandler!({} as never, {
      source: 'bytes' as const,
      data: new Uint8Array([1, 2, 3]),
      name: 'data',
      ext: 'bin'
    })

    const getPathHandler = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([ch]) => ch === IpcChannel.File_GetPhysicalPath)?.[1]
    expect(getPathHandler).toBeDefined()

    const physicalPath = await getPathHandler!({} as never, { id: entry.id })
    expect(physicalPath).toContain(entry.id)
    expect(physicalPath).toContain('bin')
  })
})
