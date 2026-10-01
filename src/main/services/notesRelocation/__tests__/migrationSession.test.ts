import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertNotesPathNotMutatingDuringMigration,
  completeNotesMigrationCommit,
  getNotesMigrationSessionId,
  isNotesDirectoryMigrationInFlight,
  releaseNotesMigrationSession,
  setNotesMigrationBlockedRoots,
  tryBeginNotesDirectoryMigration
} from '../migrationSession'

describe('notes migration session', () => {
  afterEach(() => {
    releaseNotesMigrationSession()
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

  it('releases the session only when commit matches the active migration id', () => {
    expect(tryBeginNotesDirectoryMigration()).toBe(true)
    const sessionId = getNotesMigrationSessionId()
    expect(sessionId).toBeTruthy()

    completeNotesMigrationCommit(crypto.randomUUID())
    expect(isNotesDirectoryMigrationInFlight()).toBe(true)

    completeNotesMigrationCommit(sessionId!)
    expect(isNotesDirectoryMigrationInFlight()).toBe(false)
  })
})
