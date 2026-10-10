import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { BaseService } from '@main/core/lifecycle'

const electronMocks = vi.hoisted(() => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() }
}))
vi.mock('electron', () => electronMocks)

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { FileManager } = await import('@main/services/file/FileManager')
const { createFileManagerStorageAdapter } = await import('../persistedOutputAdapter')

const TS = 1700000000000
const MESSAGE_ID = '019606a0-0000-7000-8000-00000000ad01'
const BIG_TEXT = Array.from({ length: 300 }, (_, i) => `adapter line ${i + 1} with padding`).join('\n')

describe('createFileManagerStorageAdapter', () => {
  const dbh = setupTestDatabase()
  let tmp: string
  let internalRoot: string
  let fm: InstanceType<typeof FileManager>

  beforeEach(async () => {
    MockMainDbServiceUtils.setDb(dbh.db)
    MockMainCacheServiceUtils.resetMocks()
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-pers-adapter-'))
    internalRoot = path.join(tmp, 'files-internal')
    await mkdir(internalRoot, { recursive: true })
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? path.join(internalRoot, filename) : internalRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
    BaseService.resetInstances()
    fm = new FileManager()
    const container = application.getContainer()
    vi.mocked(application.get).mockImplementation((name: string) => (name === 'FileManager' ? fm : container.get(name)))

    // Assistant placeholder row the provisional ref targets.
    const topicId = 'topic-adapter'
    const rootId = '019606a0-0000-7000-8000-00000000ad00'
    await dbh.db.insert(topicTable).values({ id: topicId, activeNodeId: MESSAGE_ID, orderKey: 'a0' })
    await dbh.db.insert(messageTable).values([
      {
        id: rootId,
        parentId: null,
        topicId,
        role: 'root',
        data: { parts: [] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: TS,
        updatedAt: TS
      },
      {
        id: MESSAGE_ID,
        parentId: rootId,
        topicId,
        role: 'assistant',
        data: { parts: [] },
        status: 'pending',
        siblingsGroupId: 0,
        createdAt: TS,
        updatedAt: TS
      }
    ])
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('write creates the blob entry, a provisional tool_output ref, and feeds the allow-list', async () => {
    const persistedOutputPaths = new Set<string>()
    const adapter = createFileManagerStorageAdapter({ messageId: MESSAGE_ID, persistedOutputPaths })

    await adapter.write('vfs_0123456789abcdef.txt', BIG_TEXT)

    const entries = await dbh.db.select().from(fileEntryTable)
    expect(entries).toHaveLength(1)
    expect(entries[0].cleanupPolicy).toBe('delete_when_unreferenced')

    const refs = await dbh.db.select().from(chatMessageFileRefTable)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ fileEntryId: entries[0].id, sourceId: MESSAGE_ID, role: 'tool_output' })

    const physical = path.join(internalRoot, `${entries[0].id}.txt`)
    expect(await adapter.getPhysicalPath!('vfs_0123456789abcdef.txt')).toBe(physical)
    expect([...persistedOutputPaths]).toEqual([physical])
    expect(await adapter.exists!('vfs_0123456789abcdef.txt')).toBe(true)
    expect(await adapter.exists!('vfs_ffffffffffffffff.txt')).toBe(false)
  })

  it('re-writing the same content is idempotent (one entry, one ref)', async () => {
    const adapter = createFileManagerStorageAdapter({ messageId: MESSAGE_ID })
    await adapter.write('vfs_0123456789abcdef.txt', BIG_TEXT)
    await adapter.write('vfs_0123456789abcdef.txt', BIG_TEXT)

    expect(await dbh.db.select().from(fileEntryTable)).toHaveLength(1)
    expect(await dbh.db.select().from(chatMessageFileRefTable)).toHaveLength(1)
  })

  it('a vanished message row leaves the blob unreferenced without throwing', async () => {
    const adapter = createFileManagerStorageAdapter({ messageId: '019606a0-dead-7000-8000-000000000000' })
    await adapter.write('vfs_0123456789abcdef.txt', BIG_TEXT)

    expect(await dbh.db.select().from(fileEntryTable)).toHaveLength(1)
    expect(await dbh.db.select().from(chatMessageFileRefTable)).toHaveLength(0)
  })
})
