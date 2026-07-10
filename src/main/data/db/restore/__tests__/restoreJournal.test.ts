import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RestoreJournal } from '@data/db/restore/restoreJournal'
import { hasPendingRestore, readRestoreJournal, writeRestoreJournal } from '@data/db/restore/restoreJournal'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The journal path is resolved through `application.getPath`; shadow the global
 * mock so it points into a per-test throwaway userData dir (mirrors the
 * v2MigrationGate.test.ts strategy — real FS, fake path registry).
 */
let userDataDir = ''

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string, filename?: string) => {
      if (key !== 'feature.backup.restore.file') {
        throw new Error(`Unexpected path key in restoreJournal test: ${key}`)
      }
      const base = join(userDataDir, 'restore-journal.json')
      return filename ? join(base, filename) : base
    })
  }
}))

function journalPath(): string {
  return join(userDataDir, 'restore-journal.json')
}

function stagedJournal(): RestoreJournal {
  return {
    version: 1,
    restoreId: 'restore-0001',
    createdAt: '2026-07-09T12:00:00.000Z',
    state: 'staged',
    db: {
      promote: 'restore-staging/restore-0001/work.sqlite',
      aside: 'cherrystudio.sqlite.pre-restore-restore-0001',
      fingerprint: 'ab'.repeat(32),
      chain: [
        { folderMillis: 1730000000000, hash: 'hash-one' },
        { folderMillis: 1730000001000, hash: 'hash-two' }
      ]
    },
    fileResources: [
      { kind: 'blob-add', stagingPath: 'restore-staging/restore-0001/files/u1', livePath: 'Data/Files/u1' },
      {
        kind: 'note-overwrite',
        stagingPath: 'restore-staging/restore-0001/notes/a.md',
        livePath: 'Notes/a.md',
        asidePath: 'restore-staging/restore-0001/aside/a.md'
      }
    ]
  }
}

describe('restoreJournal', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'cs-restore-journal-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  describe('readRestoreJournal', () => {
    it("returns 'none' when no journal file exists", () => {
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
    })

    it('round-trips a staged journal through write + read', () => {
      writeRestoreJournal(stagedJournal())

      const result = readRestoreJournal()
      expect(result).toEqual({ kind: 'ok', journal: stagedJournal() })
    })

    it('round-trips a promoting journal (step required)', () => {
      const journal: RestoreJournal = { ...stagedJournal(), state: 'promoting', step: 'live-aside' }
      writeRestoreJournal(journal)

      const result = readRestoreJournal()
      expect(result).toEqual({ kind: 'ok', journal })
    })

    it("returns 'corrupt' for truncated JSON", () => {
      writeFileSync(journalPath(), JSON.stringify(stagedJournal()).slice(0, 40))

      expect(readRestoreJournal().kind).toBe('corrupt')
    })

    it("returns 'corrupt' for an unknown state", () => {
      writeFileSync(journalPath(), JSON.stringify({ ...stagedJournal(), state: 'imported' }))

      expect(readRestoreJournal().kind).toBe('corrupt')
    })

    it("returns 'corrupt' for a future journal version", () => {
      writeFileSync(journalPath(), JSON.stringify({ ...stagedJournal(), version: 2 }))

      expect(readRestoreJournal().kind).toBe('corrupt')
    })

    it("returns 'corrupt' when a staged journal carries a step", () => {
      writeFileSync(journalPath(), JSON.stringify({ ...stagedJournal(), step: 'gate-passed' }))

      expect(readRestoreJournal().kind).toBe('corrupt')
    })

    it("returns 'corrupt' when a promoting journal is missing its step", () => {
      writeFileSync(journalPath(), JSON.stringify({ ...stagedJournal(), state: 'promoting' }))

      expect(readRestoreJournal().kind).toBe('corrupt')
    })

    it('ignores a stray .tmp leftover from an interrupted write', () => {
      writeRestoreJournal(stagedJournal())
      writeFileSync(`${journalPath()}.tmp`, 'garbage from a crashed writer')

      expect(readRestoreJournal()).toEqual({ kind: 'ok', journal: stagedJournal() })
    })
  })

  describe('writeRestoreJournal', () => {
    it('atomically replaces an existing journal', () => {
      writeRestoreJournal(stagedJournal())
      const updated: RestoreJournal = { ...stagedJournal(), state: 'failed', step: 'live-aside' }
      writeRestoreJournal(updated)

      expect(readRestoreJournal()).toEqual({ kind: 'ok', journal: updated })
      expect(() => JSON.parse(readFileSync(journalPath(), 'utf8'))).not.toThrow()
    })
  })

  describe('hasPendingRestore', () => {
    it.each([
      ['staged', true],
      ['promoting', true],
      ['completed', false],
      ['failed', false],
      ['expired', false]
    ] as const)('state %s → %s', (state, expected) => {
      const journal =
        state === 'staged' ? stagedJournal() : ({ ...stagedJournal(), state, step: 'work-promoted' } as RestoreJournal)
      writeRestoreJournal(journal)

      expect(hasPendingRestore()).toBe(expected)
    })

    it('returns true for a corrupt journal (fail-safe: sweep must stand aside)', () => {
      writeFileSync(journalPath(), '{ not json')

      expect(hasPendingRestore()).toBe(true)
    })

    it('returns false when no journal exists', () => {
      expect(hasPendingRestore()).toBe(false)
    })
  })
})
