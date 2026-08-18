import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { durableFileIo } from '@main/utils/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * File I/O for the v2 journal. The pure schema is covered by
 * `restoreJournalV2.test.ts`; this file proves the durable-write / strict-read
 * behaviour around it. The journal path is resolved through
 * `application.getPath`; shadow the global mock so it points into a per-test
 * throwaway userData dir (real FS, fake path registry).
 */
let userDataDir = ''

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string) => {
      if (key !== 'feature.backup.restore.file') {
        throw new Error(`Unexpected path key in restoreJournalV2 I/O test: ${key}`)
      }
      return join(userDataDir, 'restore-journal.json')
    })
  }
}))

function journalPath(): string {
  return join(userDataDir, 'restore-journal.json')
}

function preparedJournal(): RestoreJournalV2 {
  return {
    version: 2,
    restoreId: '11111111-2222-4333-8444-555555555555',
    preset: 'full',
    createdAt: '2026-07-27T00:00:00.000Z',
    state: 'prepared',
    db: {
      promote: 'restore-staging/11111111-2222-4333-8444-555555555555/backup.sqlite',
      aside: 'cherrystudio.sqlite.pre-restore',
      chain: [{ folderMillis: 1_730_000_000_000, hash: 'hash-one' }]
    },
    resourceInstalls: []
  }
}

describe('restoreJournalV2 file I/O', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'cs-restore-journal-v2-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  describe('readRestoreJournalV2', () => {
    it("returns 'none' when no journal file exists", () => {
      expect(readRestoreJournalV2()).toEqual({ kind: 'none' })
    })

    it('round-trips a prepared journal', () => {
      writeRestoreJournalV2(preparedJournal())

      expect(readRestoreJournalV2()).toEqual({ kind: 'ok', journal: preparedJournal() })
    })

    it('round-trips a promoting journal with its step', () => {
      const journal: RestoreJournalV2 = { ...preparedJournal(), state: 'promoting', step: 'live-aside' }
      writeRestoreJournalV2(journal)

      expect(readRestoreJournalV2()).toEqual({ kind: 'ok', journal })
    })

    it("returns 'corrupt' for truncated JSON", () => {
      writeFileSync(journalPath(), JSON.stringify(preparedJournal()).slice(0, 40))

      expect(readRestoreJournalV2().kind).toBe('corrupt')
    })

    it("returns 'corrupt' for a v1 journal rather than reinterpreting it", () => {
      // Strict-version quarantine (§5.2): a downgrade must fail, never be
      // read as "close enough" — v1's fingerprint/fileResources shape would
      // otherwise be silently dropped by a v2 reader.
      writeFileSync(
        journalPath(),
        JSON.stringify({
          version: 1,
          restoreId: 'restore-0001',
          createdAt: '2026-07-09T12:00:00.000Z',
          state: 'staged',
          db: { promote: 'work.sqlite', aside: 'aside.sqlite', fingerprint: 'ab'.repeat(32), chain: [] },
          fileResources: []
        })
      )

      expect(readRestoreJournalV2().kind).toBe('corrupt')
    })

    it("returns 'corrupt' for a future journal version", () => {
      writeFileSync(journalPath(), JSON.stringify({ ...preparedJournal(), version: 3 }))

      expect(readRestoreJournalV2().kind).toBe('corrupt')
    })

    it("returns 'corrupt' when a promoting journal is missing its step", () => {
      writeFileSync(journalPath(), JSON.stringify({ ...preparedJournal(), state: 'promoting' }))

      expect(readRestoreJournalV2().kind).toBe('corrupt')
    })

    it("returns 'corrupt' — not 'none' — when the journal cannot be read at all", () => {
      // A directory in the journal's place yields EISDIR, not ENOENT. Only
      // ENOENT may claim "absent"; every other errno must fail safe, because
      // the reclaim guard treats "absent" as permission to delete.
      mkdirSync(journalPath())

      expect(readRestoreJournalV2().kind).toBe('corrupt')
    })

    it('ignores a stray .tmp leftover from an interrupted write', () => {
      writeRestoreJournalV2(preparedJournal())
      writeFileSync(`${journalPath()}.tmp`, 'garbage from a crashed writer')

      expect(readRestoreJournalV2()).toEqual({ kind: 'ok', journal: preparedJournal() })
    })
  })

  describe('writeRestoreJournalV2', () => {
    it('atomically replaces an existing journal', () => {
      writeRestoreJournalV2(preparedJournal())
      const armed: RestoreJournalV2 = { ...preparedJournal(), state: 'armed' }
      writeRestoreJournalV2(armed)

      expect(readRestoreJournalV2()).toEqual({ kind: 'ok', journal: armed })
      expect(() => JSON.parse(readFileSync(journalPath(), 'utf8'))).not.toThrow()
    })

    it('does not leave its fixed temporary sibling after a complete write', () => {
      writeRestoreJournalV2(preparedJournal())

      expect(existsSync(`${journalPath()}.tmp`)).toBe(false)
    })

    it('preserves the last durable journal and removes tmp when the shared writer stalls', () => {
      writeRestoreJournalV2(preparedJournal())
      vi.spyOn(durableFileIo, 'writeSync').mockReturnValue(0)
      const armed: RestoreJournalV2 = { ...preparedJournal(), state: 'armed' }

      expect(() => writeRestoreJournalV2(armed)).toThrow(/made no progress/)
      expect(readRestoreJournalV2()).toEqual({ kind: 'ok', journal: preparedJournal() })
      expect(existsSync(`${journalPath()}.tmp`)).toBe(false)
    })
  })
})
