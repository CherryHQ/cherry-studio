import { BackupDomain } from '@shared/backup'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IdRemapper as IdRemapperClass } from '../IdRemapper'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('IdRemapper', () => {
  let IdRemapper: typeof IdRemapperClass

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../IdRemapper')
    IdRemapper = mod.IdRemapper
  })

  const createMockBackupClient = (tableRows: Record<string, { id: string }[]>) => ({
    execute: vi.fn().mockImplementation((query: string) => {
      for (const [table, rows] of Object.entries(tableRows)) {
        if (typeof query === 'string' && query.includes(`"${table}"`)) {
          return Promise.resolve({ rows })
        }
      }
      return Promise.resolve({ rows: [] })
    })
  })

  const createMockLiveDb = (existingIds: Set<string>) => ({
    all: vi.fn().mockImplementation(() => {
      return Promise.resolve([...existingIds].map((id) => ({ id })))
    })
  })

  it('remaps colliding UUIDs with v4 for V4 tables', async () => {
    const remapper = new IdRemapper()
    const backupClient = createMockBackupClient({
      topic: [{ id: 'uuid-a' }, { id: 'uuid-b' }]
    })
    const liveDb = createMockLiveDb(new Set(['uuid-a']))

    await remapper.buildMap(backupClient as never, liveDb as never, [BackupDomain.TOPICS])

    expect(remapper.remap('uuid-a')).not.toBe('uuid-a')
    expect(remapper.remap('uuid-b')).toBe('uuid-b')
  })

  it('remaps colliding UUIDs with v7 for V7 tables', async () => {
    const remapper = new IdRemapper()
    const backupClient = createMockBackupClient({
      message: [{ id: 'msg-1' }]
    })
    const liveDb = createMockLiveDb(new Set(['msg-1']))

    await remapper.buildMap(backupClient as never, liveDb as never, [BackupDomain.TOPICS])

    const newId = remapper.remap('msg-1')
    expect(newId).not.toBe('msg-1')
  })

  it('remaps colliding text IDs for agent_session using generator', async () => {
    const remapper = new IdRemapper()
    const backupClient = createMockBackupClient({
      agent_session: [{ id: 'session_1234_abcd' }]
    })
    const liveDb = createMockLiveDb(new Set(['session_1234_abcd']))

    await remapper.buildMap(backupClient as never, liveDb as never, [BackupDomain.AGENTS])

    const newId = remapper.remap('session_1234_abcd')
    expect(newId).not.toBe('session_1234_abcd')
    expect(newId).toMatch(/^session_\d+_[0-9a-f]{8}$/)
  })

  it('remaps colliding text IDs for agent_task using generator', async () => {
    const remapper = new IdRemapper()
    const backupClient = createMockBackupClient({
      agent_task: [{ id: 'task_5678_efgh' }]
    })
    const liveDb = createMockLiveDb(new Set(['task_5678_efgh']))

    await remapper.buildMap(backupClient as never, liveDb as never, [BackupDomain.AGENTS])

    const newId = remapper.remap('task_5678_efgh')
    expect(newId).not.toBe('task_5678_efgh')
    expect(newId).toMatch(/^task_\d+_[0-9a-f]{8}$/)
  })

  it('does not remap non-colliding text IDs', async () => {
    const remapper = new IdRemapper()
    const backupClient = createMockBackupClient({
      agent_session: [{ id: 'session_new_1234' }]
    })
    const liveDb = createMockLiveDb(new Set())

    await remapper.buildMap(backupClient as never, liveDb as never, [BackupDomain.AGENTS])

    expect(remapper.remap('session_new_1234')).toBe('session_new_1234')
  })

  it('skips tables not in V4/V7/TEXT_ID categories', async () => {
    const remapper = new IdRemapper()
    const backupClient = createMockBackupClient({
      preference: [{ id: 'pref-1' }]
    })
    const liveDb = createMockLiveDb(new Set(['pref-1']))

    await remapper.buildMap(backupClient as never, liveDb as never, [BackupDomain.PREFERENCES])

    expect(remapper.remap('pref-1')).toBe('pref-1')
  })

  it('addMapping allows external callers to inject mappings', () => {
    const remapper = new IdRemapper()
    remapper.addMapping('old-id', 'new-id')

    expect(remapper.remap('old-id')).toBe('new-id')
    expect(remapper.getMap().get('old-id')).toBe('new-id')
  })
})
