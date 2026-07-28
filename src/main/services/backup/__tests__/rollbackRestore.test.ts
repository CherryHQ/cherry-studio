import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
const { relaunch } = vi.hoisted(() => ({ relaunch: vi.fn() }))
vi.mock('@application', () => ({
  application: {
    getPath: (key: string) => {
      const paths: Record<string, string> = {
        'app.userdata': userData,
        'app.database.file': join(userData, 'Data', 'cherrystudio.sqlite'),
        'feature.backup.restore.file': join(userData, 'Data', 'restore-journal.json'),
        'feature.backup.restore.staging': join(userData, 'restore-staging')
      }
      if (!paths[key]) throw new Error(`unexpected path ${key}`)
      return paths[key]
    },
    relaunch
  }
}))

import {
  dbAsideRelPath,
  readRestoreJournal,
  stagedDbRelPath,
  writeRestoreJournal
} from '@data/db/restore/restoreJournal'

import { armRestoreRollback } from '../rollbackRestore'

const restoreId = '11111111-2222-4333-8444-555555555555'
function completed() {
  return {
    version: 2 as const,
    restoreId,
    createdAt: '2026-07-27T00:00:00.000Z',
    state: 'completed' as const,
    db: {
      promote: stagedDbRelPath(restoreId),
      aside: dbAsideRelPath(restoreId),
      chain: [{ folderMillis: 1, hash: 'one' }]
    }
  }
}

describe('restore rollback', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'rollback-restore-'))
    mkdirSync(join(userData, 'Data'), { recursive: true })
    relaunch.mockReset()
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('requires a regular adjacent aside and arms rollback before relaunch', () => {
    writeFileSync(join(userData, dbAsideRelPath(restoreId)), 'old')
    writeRestoreJournal(completed())
    armRestoreRollback()
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'rollback-armed' } })
    expect(relaunch).toHaveBeenCalledOnce()
  })
})
