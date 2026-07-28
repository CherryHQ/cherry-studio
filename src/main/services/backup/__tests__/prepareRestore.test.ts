import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
        'feature.backup.restore.staging': join(userData, 'restore-staging'),
        'app.database.migrations': join(userData, 'migrations'),
        'feature.notes.data': join(userData, 'Data', 'Notes'),
        'feature.agents.system_workspaces': join(userData, 'Data', 'Agents', 'system')
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

import { armPreparedRestore, cancelPreparedRestore } from '../prepareRestore'

const restoreId = '11111111-2222-4333-8444-555555555555'
function prepared() {
  return {
    version: 2 as const,
    restoreId,
    createdAt: '2026-07-27T00:00:00.000Z',
    state: 'prepared' as const,
    db: {
      promote: stagedDbRelPath(restoreId),
      aside: dbAsideRelPath(restoreId),
      chain: [{ folderMillis: 1, hash: 'one' }]
    }
  }
}

describe('restore preparation lifecycle', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'prepare-restore-'))
    mkdirSync(join(userData, 'Data'), { recursive: true })
    relaunch.mockReset()
  })
  afterEach(() => rmSync(userData, { recursive: true, force: true }))

  it('cancels only a prepared restore and removes its owned staging tree first', () => {
    const staged = join(userData, stagedDbRelPath(restoreId))
    mkdirSync(dirname(staged), { recursive: true })
    writeFileSync(staged, 'staged')
    writeRestoreJournal(prepared())
    cancelPreparedRestore()
    expect(readRestoreJournal()).toEqual({ kind: 'none' })
  })

  it('arms only the exact preview identifier before relaunch', () => {
    writeRestoreJournal(prepared())
    expect(() => armPreparedRestore('22222222-2222-4222-8222-222222222222')).toThrow(/no longer matches/)
    armPreparedRestore(restoreId)
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'armed' } })
    expect(relaunch).toHaveBeenCalledOnce()
  })
})
