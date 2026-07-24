import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { readRestoreJournalMock, clearRestoreJournalMock, getRegistry, reindexItemsMock, getRootItemsByBaseIdMock } =
  vi.hoisted(() => ({
    readRestoreJournalMock: vi.fn(),
    clearRestoreJournalMock: vi.fn(),
    getRegistry: vi.fn(() => ({ domains: [] })),
    reindexItemsMock: vi.fn(async () => {}),
    getRootItemsByBaseIdMock: vi.fn(() => [] as Array<{ id: string; status: string }>)
  }))

// Real temp dir backs the index-file existence check (no node:fs mock — BackupService
// uses existsSync for unrelated paths too).
const indexRoot = mkdtempSync(join(tmpdir(), 'kb-reindex-test-'))

vi.mock('../ImportOrchestrator', () => ({
  ImportOrchestrator: vi.fn().mockImplementation(() => ({ importBackup: vi.fn() }))
}))

vi.mock('../admitArchive', () => ({
  admitArchive: vi.fn()
}))

vi.mock('../contributors/ContributorManager', () => ({
  contributorManager: { getRegistry }
}))

vi.mock('../SqliteBackupStripper', () => ({
  SqliteBackupStripper: vi.fn()
}))

vi.mock('@main/data/db/restore/restoreJournal', () => ({
  readRestoreJournal: readRestoreJournalMock,
  clearRestoreJournal: clearRestoreJournalMock
}))

vi.mock('@data/services/KnowledgeItemService', () => ({
  knowledgeItemService: { getRootItemsByBaseId: getRootItemsByBaseIdMock }
}))

vi.mock('@main/features/knowledge', () => ({
  getKnowledgeVectorStoreFilePathSync: (baseId: string) => join(indexRoot, baseId, '.cherry', 'index.sqlite')
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory()
  const innerGet = mocked.application.get as ReturnType<typeof vi.fn>
  mocked.application.get = vi.fn((name: string) => {
    if (name === 'KnowledgeService') {
      return { reindexItems: reindexItemsMock }
    }
    return innerGet(name)
  })
  return mocked
})

import { BaseService } from '@main/core/lifecycle'

import { BackupService } from '../BackupService'

// Mock getPath: userData=/mock/app.userdata, knowledgeRoot=/mock/feature.knowledgebase.data.
// Journal livePaths are stored userData-relative, so `../feature.knowledgebase.data/<baseId>`
// resolves to a direct child of the knowledge root under the mock layout.
const KB_LIVE = (baseId: string) => `../feature.knowledgebase.data/${baseId}`

function completedJournal(fileResources: Array<{ kind: string; stagingPath: string; livePath: string }>) {
  return {
    kind: 'ok' as const,
    journal: {
      version: 1,
      restoreId: 'rst-1',
      createdAt: '2026-07-24T00:00:00.000Z',
      state: 'completed',
      db: { promote: 'p', aside: 'a', fingerprint: 'f', chain: [{ folderMillis: 1, hash: 'h' }] },
      fileResources
    }
  }
}

async function runReindex(): Promise<void> {
  // Reset per call (not just per test) — the singleton guard rejects a second
  // construction and some tests drive the scan twice.
  BaseService.resetInstances()
  const service = new BackupService()
  await (
    service as unknown as { enqueueRestoredKnowledgeReindex: () => Promise<void> }
  ).enqueueRestoredKnowledgeReindex()
}

describe('BackupService post-restore knowledge reindex (B2)', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    readRestoreJournalMock.mockReturnValue({ kind: 'none' })
    getRootItemsByBaseIdMock.mockReturnValue([])
  })

  afterAll(() => {
    rmSync(indexRoot, { recursive: true, force: true })
  })

  it('enqueues reindex of completed roots for restored knowledge dir-add bases', async () => {
    readRestoreJournalMock.mockReturnValue(
      completedJournal([{ kind: 'dir-add', stagingPath: 's/kb1', livePath: KB_LIVE('kb1') }])
    )
    getRootItemsByBaseIdMock.mockReturnValue([
      { id: 'root-a', status: 'completed' },
      { id: 'root-b', status: 'failed' },
      { id: 'root-c', status: 'completed' }
    ])

    await runReindex()

    expect(getRootItemsByBaseIdMock).toHaveBeenCalledWith('kb1')
    expect(reindexItemsMock).toHaveBeenCalledTimes(1)
    expect(reindexItemsMock).toHaveBeenCalledWith('kb1', ['root-a', 'root-c'])
  })

  it('does nothing without a completed journal', async () => {
    readRestoreJournalMock.mockReturnValue({ kind: 'none' })
    await runReindex()

    const failed = completedJournal([{ kind: 'dir-add', stagingPath: 's/kb1', livePath: KB_LIVE('kb1') }])
    readRestoreJournalMock.mockReturnValue({ ...failed, journal: { ...failed.journal, state: 'failed' } })
    await runReindex()

    expect(reindexItemsMock).not.toHaveBeenCalled()
  })

  it('ignores non-knowledge dir-add entries (skills) and non-dir-add kinds', async () => {
    readRestoreJournalMock.mockReturnValue(
      completedJournal([
        { kind: 'dir-add', stagingPath: 's/skill', livePath: '../feature.agents.skills/my-skill' },
        { kind: 'blob-add', stagingPath: 's/f1', livePath: 'Data/Files/f1.png' },
        { kind: 'note-add', stagingPath: 's/n1', livePath: 'Data/Notes/n1.md' }
      ])
    )

    await runReindex()

    expect(reindexItemsMock).not.toHaveBeenCalled()
  })

  it('skips a base whose index file already exists (cross-boot idempotency)', async () => {
    mkdirSync(join(indexRoot, 'kb-built', '.cherry'), { recursive: true })
    writeFileSync(join(indexRoot, 'kb-built', '.cherry', 'index.sqlite'), '')
    readRestoreJournalMock.mockReturnValue(
      completedJournal([{ kind: 'dir-add', stagingPath: 's/kb-built', livePath: KB_LIVE('kb-built') }])
    )
    getRootItemsByBaseIdMock.mockReturnValue([{ id: 'root-a', status: 'completed' }])

    await runReindex()

    expect(reindexItemsMock).not.toHaveBeenCalled()
  })

  it('skips a base with no completed roots', async () => {
    readRestoreJournalMock.mockReturnValue(
      completedJournal([{ kind: 'dir-add', stagingPath: 's/kb1', livePath: KB_LIVE('kb1') }])
    )
    getRootItemsByBaseIdMock.mockReturnValue([{ id: 'root-a', status: 'processing' }])

    await runReindex()

    expect(reindexItemsMock).not.toHaveBeenCalled()
  })

  it('isolates per-base failures (one failing base does not block the rest)', async () => {
    readRestoreJournalMock.mockReturnValue(
      completedJournal([
        { kind: 'dir-add', stagingPath: 's/kb1', livePath: KB_LIVE('kb1') },
        { kind: 'dir-add', stagingPath: 's/kb2', livePath: KB_LIVE('kb2') }
      ])
    )
    getRootItemsByBaseIdMock.mockReturnValue([{ id: 'root-a', status: 'completed' }])
    reindexItemsMock.mockRejectedValueOnce(new Error('base gone'))

    await runReindex()

    expect(reindexItemsMock).toHaveBeenCalledTimes(2)
    expect(reindexItemsMock).toHaveBeenNthCalledWith(1, 'kb1', ['root-a'])
    expect(reindexItemsMock).toHaveBeenNthCalledWith(2, 'kb2', ['root-a'])
  })
})
