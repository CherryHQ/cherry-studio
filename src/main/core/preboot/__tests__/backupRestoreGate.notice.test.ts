import { app, dialog } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadJournalResult } from '@data/db/restore/restoreJournal'

const journal = vi.hoisted(() => ({ result: { kind: 'none' } as ReadJournalResult }))

vi.mock('@data/db/restore/restoreJournal', () => ({ readRestoreJournal: () => journal.result }))
vi.mock('@data/db/restore/restorePromotion', () => ({
  runRestorePromotion: async () => {},
  cleanupTerminalRestoreArtifacts: () => {
    journal.result = { kind: 'none' }
  }
}))

import { runBackupRestoreGate } from '../backupRestoreGate'

function setOutcome(state: 'failed' | 'expired' | 'completed') {
  journal.result = {
    kind: 'ok',
    journal: {
      version: 1,
      restoreId: 'restore-notice',
      createdAt: '2026-10-11T00:00:00Z',
      state,
      db: {
        promote: 'work.sqlite',
        aside: 'aside.sqlite',
        fingerprint: 'hash',
        chain: [{ folderMillis: 1, hash: 'hash' }]
      },
      fileResources: []
    }
  }
}

beforeEach(() => {
  journal.result = { kind: 'none' }
  app.whenReady = vi.fn().mockResolvedValue(undefined)
  app.getLocale = vi.fn(() => 'zh-CN')
  vi.mocked(dialog.showErrorBox).mockClear()
})

describe('restore outcome notice', () => {
  it.each(['failed', 'expired'] as const)('explains a %s restore after consuming its journal', async (state) => {
    setOutcome(state)

    await runBackupRestoreGate()

    expect(journal.result).toEqual({ kind: 'none' })
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      '备份恢复失败',
      '无法恢复备份，原有数据已保留。请重试恢复；如果问题持续，请查看应用日志。'
    )
  })

  it('keeps normal startup quiet when no restore is pending', async () => {
    await runBackupRestoreGate()

    expect(dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('does not report a completed restore as failed', async () => {
    setOutcome('completed')

    await runBackupRestoreGate()

    expect(dialog.showErrorBox).not.toHaveBeenCalled()
  })
})
