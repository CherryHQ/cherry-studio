import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  readRestoreJournalFormatVersion,
  restoreJournalIo,
  stagedDbRelPath,
  writeRestoreJournal
} from '../restoreJournal'

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

describe('restore journal file I/O', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'restore-journal-'))
    mkdirSync(join(userData, 'Data'), { recursive: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(userData, { recursive: true, force: true })
  })

  it('round-trips an expected journal and rejects redirected paths', () => {
    writeRestoreJournal(prepared())
    expect(readRestoreJournal()).toEqual({ kind: 'ok', journal: prepared() })
    writeFileSync(
      join(userData, 'Data', 'restore-journal.json'),
      JSON.stringify({ ...prepared(), db: { ...prepared().db, aside: 'Data/other.sqlite' } })
    )
    expect(readRestoreJournal().kind).toBe('corrupt')
  })

  it('does not replace a valid journal when a short write makes no progress', () => {
    writeRestoreJournal(prepared())
    vi.spyOn(restoreJournalIo, 'writeSync').mockReturnValue(0)
    expect(() => writeRestoreJournal({ ...prepared(), state: 'armed' })).toThrow(/made no progress/)
    expect(JSON.parse(readFileSync(join(userData, 'Data', 'restore-journal.json'), 'utf8')).state).toBe('prepared')
  })

  it('probes only known journal versions before preboot dispatch', () => {
    const journalPath = join(userData, 'Data', 'restore-journal.json')
    expect(readRestoreJournalFormatVersion()).toBe('none')
    writeFileSync(journalPath, JSON.stringify({ version: 1 }))
    expect(readRestoreJournalFormatVersion()).toBe(1)
    writeFileSync(journalPath, JSON.stringify(prepared()))
    expect(readRestoreJournalFormatVersion()).toBe(2)
    writeFileSync(journalPath, JSON.stringify({ version: 3 }))
    expect(readRestoreJournalFormatVersion()).toBe('unknown')
    writeFileSync(journalPath, '{')
    expect(readRestoreJournalFormatVersion()).toBe('unknown')
  })
})
