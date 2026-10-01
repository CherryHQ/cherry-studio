import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertNotesPathNotMutatingDuringMigration,
  releaseNotesMigrationSession,
  setNotesMigrationBlockedRoots
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
})
