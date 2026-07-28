import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
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
    }
  }
}))

import {
  dbAsideRelPath,
  readRestoreJournal,
  stagedDbRelPath,
  writeRestoreJournal
} from '@data/db/restore/restoreJournal'

import { acknowledgeRestore } from '../acknowledgeRestore'

const restoreId = '11111111-2222-4333-8444-555555555555'
function completed(state: 'completed' | 'armed' = 'completed') {
  return {
    version: 2 as const,
    restoreId,
    createdAt: '2026-07-27T00:00:00.000Z',
    state,
    db: {
      promote: stagedDbRelPath(restoreId),
      aside: dbAsideRelPath(restoreId),
      chain: [{ folderMillis: 1, hash: 'one' }]
    }
  }
}

describe('restore acknowledgement', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'ack-restore-'))
    mkdirSync(join(userData, 'Data'), { recursive: true })
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('deletes the rollback aside before the journal', () => {
    const aside = join(userData, dbAsideRelPath(restoreId))
    writeFileSync(aside, 'old')
    writeRestoreJournal(completed())
    expect(acknowledgeRestore()).toMatchObject({ acknowledged: true, removed: 1 })
    expect(existsSync(aside)).toBe(false)
    expect(readRestoreJournal()).toEqual({ kind: 'none' })
  })

  it('refuses to release an active restore', () => {
    writeRestoreJournal(completed('armed'))
    expect(() => acknowledgeRestore()).toThrow(/cannot be acknowledged/)
  })
})
