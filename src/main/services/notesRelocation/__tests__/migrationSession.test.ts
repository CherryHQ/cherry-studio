import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import {
  assertNotesPathNotMutatingDuringMigration,
  assertNotesPathNotRetired,
  clearNotesMigrationPairsForTests,
  beginNotesBatchMarkdownUpload,
  beginNotesFilesystemMutation,
  completeNotesMigrationCommit,
  endNotesBatchMarkdownUpload,
  endNotesFilesystemMutation,
  getNotesMigrationSessionId,
  isNotesDirectoryMigrationInFlight,
  releaseNotesMigrationSession,
  setNotesMigrationBlockedRoots,
  tryBeginNotesDirectoryMigration,
  waitForNotesBatchMarkdownUploadsIdle,
  waitForNotesFilesystemMutationsIdle
} from '../migrationSession'

describe('notes migration session', () => {
  afterEach(() => {
    releaseNotesMigrationSession()
    clearNotesMigrationPairsForTests()
    vi.restoreAllMocks()
  })

  it('blocks writes through a symlink alias into the source root', () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-src-alias-'))
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-tgt-alias-'))
    const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-alias-'))
    const alias = path.join(aliasRoot, 'notes-alias')
    fs.symlinkSync(source, alias)

    setNotesMigrationBlockedRoots(source, target)

    expect(() => assertNotesPathNotMutatingDuringMigration(path.join(alias, 'new.md'))).toThrow(
      /migration is in progress/
    )
  })

  it('blocks child filenames that start with double dots but stay inside the root', () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-src-dotdot-'))
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-tgt-dotdot-'))
    const edgeCase = path.join(source, '..draft.md')
    fs.writeFileSync(edgeCase, '# draft')

    setNotesMigrationBlockedRoots(source, target)

    expect(() => assertNotesPathNotMutatingDuringMigration(edgeCase)).toThrow(/migration is in progress/)
  })

  it('blocks mutations of a parent directory that contains the notes root', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-parent-'))
    const source = path.join(parent, 'notes-lib')
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-tgt-parent-'))
    fs.mkdirSync(source, { recursive: true })

    setNotesMigrationBlockedRoots(source, target)

    expect(() => assertNotesPathNotMutatingDuringMigration(parent)).toThrow(/migration is in progress/)
  })

  it('blocks filesystem mutations under source and target roots during copy', () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-src-'))
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-tgt-'))
    const nested = path.join(source, 'note.md')
    fs.writeFileSync(nested, '# hello')

    setNotesMigrationBlockedRoots(source, target)

    expect(() => assertNotesPathNotMutatingDuringMigration(nested)).toThrow(/migration is in progress/)
    expect(() => assertNotesPathNotMutatingDuringMigration(path.join(target, 'note.md'))).toThrow(
      /migration is in progress/
    )
    expect(() => assertNotesPathNotMutatingDuringMigration(path.join(os.tmpdir(), 'other.md'))).not.toThrow()
  })

  it('waits for in-flight batch markdown uploads before installing the write barrier', async () => {
    beginNotesBatchMarkdownUpload()
    const idle = waitForNotesBatchMarkdownUploadsIdle()
    let settled = false
    void idle.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    endNotesBatchMarkdownUpload()
    await idle
    expect(settled).toBe(true)
  })

  it('rejects new batch uploads while a migration session is in flight', () => {
    expect(tryBeginNotesDirectoryMigration()).toBe(true)
    expect(() => beginNotesBatchMarkdownUpload()).toThrow(/migration is in progress/)
  })

  it('allows flush writes after migration begins but before blocked roots are installed', () => {
    expect(tryBeginNotesDirectoryMigration()).toBe(true)
    expect(() => beginNotesFilesystemMutation()).not.toThrow()
    endNotesFilesystemMutation()
  })

  it('still allows filesystem mutations outside migration roots once the write barrier is active', () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-src-outside-'))
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-tgt-outside-'))
    setNotesMigrationBlockedRoots(source, target)

    expect(() => beginNotesFilesystemMutation()).not.toThrow()
    endNotesFilesystemMutation()
    expect(() => assertNotesPathNotMutatingDuringMigration(path.join(os.tmpdir(), 'skill.md'))).not.toThrow()
  })

  it('waits for in-flight filesystem mutations before installing the write barrier', async () => {
    beginNotesFilesystemMutation()
    const idle = waitForNotesFilesystemMutationsIdle()
    let settled = false
    void idle.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    endNotesFilesystemMutation()
    await idle
    expect(settled).toBe(true)
  })

  it('releases the session only when commit matches the active migration id', () => {
    expect(tryBeginNotesDirectoryMigration()).toBe(true)
    const sessionId = getNotesMigrationSessionId()
    expect(sessionId).toBeTruthy()

    completeNotesMigrationCommit(crypto.randomUUID())
    expect(isNotesDirectoryMigrationInFlight()).toBe(true)

    completeNotesMigrationCommit(sessionId!)
    expect(isNotesDirectoryMigrationInFlight()).toBe(false)
  })

  describe('release classification', () => {
    const mockPreference = (read: { value: unknown; provenance: string }) => {
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => read)
      })
    }

    it('retires the source root when the canonical preference resolves target-active', () => {
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-src-'))
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-tgt-'))
      mockPreference({ value: target, provenance: 'cache' })

      setNotesMigrationBlockedRoots(source, target)
      releaseNotesMigrationSession()

      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).toThrow(/relocated/)
      expect(() => assertNotesPathNotRetired(path.join(target, 'note.md'))).not.toThrow()
    })

    it('lifts cleanly when the canonical preference still resolves source-active', () => {
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-src-'))
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-tgt-'))
      mockPreference({ value: source, provenance: 'cache' })

      setNotesMigrationBlockedRoots(source, target)
      releaseNotesMigrationSession()

      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).not.toThrow()
      expect(() => assertNotesPathNotRetired(path.join(target, 'note.md'))).not.toThrow()
    })

    it('closes loud under both roots when the preference cache is not ready', () => {
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-src-'))
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-tgt-'))
      mockPreference({ value: '', provenance: 'not-ready' })

      setNotesMigrationBlockedRoots(source, target)
      releaseNotesMigrationSession()

      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).toThrow(/cannot be verified/)
      expect(() => assertNotesPathNotRetired(path.join(target, 'note.md'))).toThrow(/cannot be verified/)
    })

    it('retires both roots when a plain settings move points the canonical root elsewhere', () => {
      // A configured root matching neither migration root is a SETTLED state
      // (the notes live at the unrelated root now), not a failed resolution:
      // classifying it 'unresolved' made the Retry banner dead forever.
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-src-'))
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-tgt-'))
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-else-'))
      mockPreference({ value: elsewhere, provenance: 'cache' })

      setNotesMigrationBlockedRoots(source, target)
      releaseNotesMigrationSession()

      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).toThrow(/relocated/)
      expect(() => assertNotesPathNotRetired(path.join(target, 'note.md'))).toThrow(/relocated/)
      expect(() => assertNotesPathNotRetired(path.join(elsewhere, 'note.md'))).not.toThrow()
    })

    it('retires every superseded root across a migration chain (A->B->C)', () => {
      const a = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-chain-a-'))
      const b = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-chain-b-'))
      const c = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-chain-c-'))

      setNotesMigrationBlockedRoots(a, b)
      releaseNotesMigrationSession()
      setNotesMigrationBlockedRoots(b, c)
      releaseNotesMigrationSession()
      mockPreference({ value: c, provenance: 'cache' })

      // Both intermediate roots are retired against the canonical C - never
      // the dead 'unresolved' Retry that pair-local resolution produced.
      expect(() => assertNotesPathNotRetired(path.join(a, 'note.md'))).toThrow(/relocated/)
      expect(() => assertNotesPathNotRetired(path.join(b, 'note.md'))).toThrow(/relocated/)
      expect(() => assertNotesPathNotRetired(path.join(c, 'note.md'))).not.toThrow()
    })

    it('keeps an unflipped chain target editable while its flip never landed', () => {
      // Chain A->B->C where the canonical root still sits at B: the B->C flip
      // never landed, so C stays editable (both roots of the unflipped pair),
      // while A stays retired behind the landed A->B move.
      const a = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-chain2-a-'))
      const b = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-chain2-b-'))
      const c = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-chain2-c-'))

      setNotesMigrationBlockedRoots(a, b)
      releaseNotesMigrationSession()
      setNotesMigrationBlockedRoots(b, c)
      releaseNotesMigrationSession()
      mockPreference({ value: b, provenance: 'cache' })

      expect(() => assertNotesPathNotRetired(path.join(a, 'note.md'))).toThrow(/relocated/)
      expect(() => assertNotesPathNotRetired(path.join(b, 'note.md'))).not.toThrow()
      expect(() => assertNotesPathNotRetired(path.join(c, 'note.md'))).not.toThrow()
    })

    it('retires the intermediate root after a reversal (A->B then B->A)', () => {
      const a = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rev-a-'))
      const b = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rev-b-'))

      setNotesMigrationBlockedRoots(a, b)
      releaseNotesMigrationSession()
      setNotesMigrationBlockedRoots(b, a)
      releaseNotesMigrationSession()
      mockPreference({ value: a, provenance: 'cache' })

      expect(() => assertNotesPathNotRetired(path.join(a, 'note.md'))).not.toThrow()
      expect(() => assertNotesPathNotRetired(path.join(b, 'note.md'))).toThrow(/relocated/)
    })

    it('recovers from unresolved to resolved on a later classification', () => {
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rec-src-'))
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rec-tgt-'))
      const preference = { read: { value: '', provenance: 'not-ready' } }
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => preference.read)
      })

      setNotesMigrationBlockedRoots(source, target)
      releaseNotesMigrationSession()
      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).toThrow(/cannot be verified/)

      // Once the cache is ready the very next edit classifies for real.
      preference.read = { value: target, provenance: 'cache' }
      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).toThrow(/relocated/)
      expect(() => assertNotesPathNotRetired(path.join(target, 'note.md'))).not.toThrow()
    })

    it('treats an empty preference as the affirmative default root', () => {
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-src-'))
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-tgt-'))
      // The default notes dir IS the source root here: an unset preference
      // must lift the barrier, not close loud.
      vi.spyOn(application, 'getPath').mockReturnValue(source)
      mockPreference({ value: '', provenance: 'cache' })

      setNotesMigrationBlockedRoots(source, target)
      releaseNotesMigrationSession()

      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).not.toThrow()
      expect(() => assertNotesPathNotRetired(path.join(target, 'note.md'))).not.toThrow()
    })

    it('retires the source on the write after a late preference flip', () => {
      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-src-'))
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rel-tgt-'))
      const preference = { read: { value: source, provenance: 'cache' } }
      MockApplicationUtils.setService('PreferenceService', {
        getWithProvenance: vi.fn(() => preference.read)
      })

      setNotesMigrationBlockedRoots(source, target)
      releaseNotesMigrationSession()
      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).not.toThrow()

      preference.read = { value: target, provenance: 'cache' }
      expect(() => assertNotesPathNotRetired(path.join(source, 'note.md'))).toThrow(/relocated/)
      expect(() => assertNotesPathNotRetired(path.join(target, 'note.md'))).not.toThrow()
    })

    it('skips classification when no blocked roots were installed', () => {
      mockPreference({ value: '', provenance: 'not-ready' })
      releaseNotesMigrationSession()
      expect(() => assertNotesPathNotRetired('/tmp/anywhere.md')).not.toThrow()
    })
  })
})
