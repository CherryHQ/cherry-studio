import type * as nodeFs from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  installedKnowledgeBaseIds,
  installResourceUnits,
  recoverResourceUnits
} from '@data/db/restore/resourceInstallV2'
import type { ResourceInstallEntry } from '@data/db/restore/restoreJournalV2'
import type { RecoveryPhase } from '@data/db/restore/restoreRecovery'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type NodeFs = typeof nodeFs

/** The one fault a real filesystem will not produce on demand: a cross-device rename. */
const { crossDevice } = vi.hoisted(() => ({ crossDevice: { on: false } }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<NodeFs & { default: NodeFs }>()
  const renameSync: NodeFs['renameSync'] = (source, target) => {
    if (!crossDevice.on) return actual.renameSync(source, target)
    const error = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException
    error.code = 'EXDEV'
    throw error
  }
  return { ...actual, renameSync, default: { ...actual.default, renameSync } }
})

/**
 * Crash matrix for the `resource-install` unit operation (§6.3, §6.4).
 *
 * Everything is real: real files, real directories, real renames on a real temp
 * filesystem. The bar every case is held to is the pair of properties the whole
 * design exists for — a unit is either fully the archive's or fully the target's
 * (never a recursive mixture), and a target that was NOT part of the restore is
 * never touched.
 *
 * The recovery cases are driven by CONSTRUCTING each `(staged, live, aside)`
 * triple directly, because that is exactly what a crash leaves behind, and then
 * re-running recovery a second time — the property that makes crash re-entry
 * safe is that the second pass is a no-op.
 */

let userData = ''

const RID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function entry(live: string, resourceType: 'file' | 'directory' = 'directory'): ResourceInstallEntry {
  return {
    resourceType,
    staging: `restore-staging/${RID}/resources/${live}`,
    live,
    aside: `restore-aside/${RID}/0-${live.split('/').pop()}`
  }
}

function abs(relative: string): string {
  return join(userData, ...relative.split('/'))
}

/** A directory unit with one file inside, so "which copy is this" is decidable. */
function makeDirUnit(relative: string, content: string): void {
  mkdirSync(abs(relative), { recursive: true })
  writeFileSync(join(abs(relative), 'doc.txt'), content)
}

function makeFileUnit(relative: string, content: string): void {
  mkdirSync(join(abs(relative), '..'), { recursive: true })
  writeFileSync(abs(relative), content)
}

function readUnit(relative: string): string {
  return readFileSync(join(abs(relative), 'doc.txt'), 'utf8')
}

describe('resourceInstallV2', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-resinstall-'))
  })

  afterEach(() => {
    crossDevice.on = false
    rmSync(userData, { recursive: true, force: true })
  })

  describe('install', () => {
    it('parks an existing target and installs the staged copy', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit(unit.live, 'TARGET')

      installResourceUnits([unit], userData)

      expect(readUnit(unit.live)).toBe('ARCHIVE')
      expect(readUnit(unit.aside)).toBe('TARGET')
      expect(existsSync(abs(unit.staging))).toBe(false)
    })

    it('installs into an absent target without creating an aside', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')

      installResourceUnits([unit], userData)

      expect(readUnit(unit.live)).toBe('ARCHIVE')
      expect(existsSync(abs(unit.aside))).toBe(false)
    })

    it('replaces a directory unit wholesale — target-only entries never survive inside it', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit(unit.live, 'TARGET')
      writeFileSync(join(abs(unit.live), 'target-only.txt'), 'x')

      installResourceUnits([unit], userData)

      expect(existsSync(join(abs(unit.live), 'target-only.txt'))).toBe(false)
      expect(existsSync(join(abs(unit.aside), 'target-only.txt'))).toBe(true)
    })

    it('refuses a symlinked target rather than following it', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit('outside', 'OUTSIDE')
      mkdirSync(abs('Data/KnowledgeBase'), { recursive: true })
      symlinkSync(abs('outside'), abs(unit.live))

      expect(() => installResourceUnits([unit], userData)).toThrow(/target-not-installable/)
      expect(readUnit('outside')).toBe('OUTSIDE')
    })

    it('refuses a target whose type differs from the unit', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeFileUnit(unit.live, 'TARGET-FILE')

      expect(() => installResourceUnits([unit], userData)).toThrow(/target-type-mismatch/)
      expect(readFileSync(abs(unit.live), 'utf8')).toBe('TARGET-FILE')
    })

    it('refuses a target reached through a symlinked ancestor', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      mkdirSync(abs('elsewhere'), { recursive: true })
      mkdirSync(abs('Data'), { recursive: true })
      symlinkSync(abs('elsewhere'), abs('Data/KnowledgeBase'))

      expect(() => installResourceUnits([unit], userData)).toThrow(/unsafe-ancestor/)
      expect(existsSync(abs('elsewhere/base-1'))).toBe(false)
    })

    it('refuses when neither the staged copy nor the target exists', () => {
      expect(() => installResourceUnits([entry('Data/KnowledgeBase/base-1')], userData)).toThrow(/staged-missing/)
    })

    it('treats an already-installed unit as done (re-entry inside one boot)', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.live, 'ARCHIVE')

      expect(() => installResourceUnits([unit], userData)).not.toThrow()
      expect(readUnit(unit.live)).toBe('ARCHIVE')
    })

    it('refuses to overwrite an aside that is already occupied', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit(unit.live, 'TARGET')
      makeDirUnit(unit.aside, 'OLDER-ASIDE')

      expect(() => installResourceUnits([unit], userData)).toThrow(/aside-occupied/)
      expect(readUnit(unit.live)).toBe('TARGET')
      expect(readUnit(unit.aside)).toBe('OLDER-ASIDE')
    })

    it('reports a cross-filesystem rename instead of falling back to a copy', () => {
      // Preparation proved the payload and the target share a device; if that
      // stopped being true by boot, the answer is a refusal, never a copy —
      // copying is not crash-atomic and this window has no rollback but rename.
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      crossDevice.on = true

      expect(() => installResourceUnits([unit], userData)).toThrow(/cross-filesystem/)
      expect(readUnit(unit.staging)).toBe('ARCHIVE')
    })

    it('installs many units and files alike in one pass', () => {
      const units = [
        entry('Data/KnowledgeBase/base-1'),
        entry('Data/KnowledgeBase/base-2'),
        entry('Data/note.md', 'file')
      ]
      makeDirUnit(units[0].staging, 'A1')
      makeDirUnit(units[1].staging, 'A2')
      makeFileUnit(units[2].staging, 'A3')

      installResourceUnits(units, userData)

      expect(readUnit(units[0].live)).toBe('A1')
      expect(readUnit(units[1].live)).toBe('A2')
      expect(readFileSync(abs(units[2].live), 'utf8')).toBe('A3')
    })
  })

  describe('recovery', () => {
    /**
     * Build one `(staged, live, aside)` triple, recover, and recover AGAIN — the
     * second pass must not change what the first one produced.
     */
    function recoverTwice(unit: ResourceInstallEntry, phase: RecoveryPhase): void {
      recoverResourceUnits([unit], userData, phase)
      const after = snapshot(unit)
      recoverResourceUnits([unit], userData, phase)
      expect(snapshot(unit)).toEqual(after)
    }

    function snapshot(unit: ResourceInstallEntry): Record<string, string | null> {
      const read = (relative: string): string | null =>
        existsSync(join(abs(relative), 'doc.txt')) ? readUnit(relative) : null
      return { staged: read(unit.staging), live: read(unit.live), aside: read(unit.aside) }
    }

    it('pre-commit: takes an installed backup back out of an originally-absent target', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.live, 'ARCHIVE')

      recoverTwice(unit, 'pre-commit')

      expect(existsSync(abs(unit.live))).toBe(false)
    })

    it('pre-commit: restores the parked target over the installed backup', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.live, 'ARCHIVE')
      makeDirUnit(unit.aside, 'TARGET')

      recoverTwice(unit, 'pre-commit')

      expect(readUnit(unit.live)).toBe('TARGET')
      expect(existsSync(abs(unit.aside))).toBe(false)
    })

    it('pre-commit: restores the parked target when the install had not started', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit(unit.aside, 'TARGET')

      recoverTwice(unit, 'pre-commit')

      expect(readUnit(unit.live)).toBe('TARGET')
    })

    it('pre-commit: leaves an untouched target alone while the backup is still staged', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit(unit.live, 'TARGET')

      recoverTwice(unit, 'pre-commit')

      expect(readUnit(unit.live)).toBe('TARGET')
    })

    it('pre-commit: a rolled-back replacement survives a crash mid-rollback', () => {
      // The property the move-only rollback exists for: after rolling back, the
      // unit must never look like "an installed backup over an absent target",
      // or a second recovery pass would delete the user's own directory.
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.live, 'ARCHIVE')
      makeDirUnit(unit.aside, 'TARGET')

      recoverResourceUnits([unit], userData, 'pre-commit')
      recoverResourceUnits([unit], userData, 'pre-commit')
      recoverResourceUnits([unit], userData, 'pre-commit')

      expect(readUnit(unit.live)).toBe('TARGET')
    })

    it('pre-commit: refuses a symlink substituted for the retained aside', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.live, 'ARCHIVE')
      makeDirUnit('outside', 'TARGET')
      mkdirSync(join(abs(unit.aside), '..'), { recursive: true })
      symlinkSync(abs('outside'), abs(unit.aside))

      expect(() => recoverResourceUnits([unit], userData, 'pre-commit')).toThrow(/recovery-source-invalid/)
      expect(readUnit(unit.live)).toBe('ARCHIVE')
      expect(readUnit('outside')).toBe('TARGET')
    })

    it('pre-commit: refuses a live path redirected after installation', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit('outside/KnowledgeBase/base-1', 'ARCHIVE')
      makeDirUnit(unit.aside, 'TARGET')
      symlinkSync(abs('outside'), abs('Data'))

      expect(() => recoverResourceUnits([unit], userData, 'pre-commit')).toThrow(/unsafe-ancestor/)
      expect(readUnit('outside/KnowledgeBase/base-1')).toBe('ARCHIVE')
      expect(readUnit(unit.aside)).toBe('TARGET')
    })

    it('pre-commit: fails closed on the unprovable staged+live+aside state', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit(unit.live, 'UNPROVABLE')
      makeDirUnit(unit.aside, 'TARGET')

      expect(() => recoverResourceUnits([unit], userData, 'pre-commit')).toThrow(/inconsistent/)
      expect(readUnit(unit.live)).toBe('UNPROVABLE')
      expect(readUnit(unit.aside)).toBe('TARGET')
    })

    it('committed: finishes an install whose rename never landed', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit(unit.aside, 'TARGET')

      recoverTwice(unit, 'committed')

      expect(readUnit(unit.live)).toBe('ARCHIVE')
      expect(readUnit(unit.aside)).toBe('TARGET')
    })

    it('committed: keeps the installed unit and its aside', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.live, 'ARCHIVE')
      makeDirUnit(unit.aside, 'TARGET')

      recoverTwice(unit, 'committed')

      expect(readUnit(unit.live)).toBe('ARCHIVE')
      expect(readUnit(unit.aside)).toBe('TARGET')
    })

    it('committed: fails closed when the live slot is empty', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.aside, 'TARGET')

      expect(() => recoverResourceUnits([unit], userData, 'committed')).toThrow(/inconsistent/)
      expect(readUnit(unit.aside)).toBe('TARGET')
    })

    it('recovers each unit from its own triple in a mixed batch', () => {
      const rolledBack = entry('Data/KnowledgeBase/base-1')
      const notStarted = entry('Data/KnowledgeBase/base-2')
      makeDirUnit(rolledBack.live, 'ARCHIVE')
      makeDirUnit(rolledBack.aside, 'TARGET')
      makeDirUnit(notStarted.staging, 'ARCHIVE')

      recoverResourceUnits([rolledBack, notStarted], userData, 'pre-commit')

      expect(readUnit(rolledBack.live)).toBe('TARGET')
      expect(existsSync(abs(notStarted.live))).toBe(false)
    })
  })

  describe('installedKnowledgeBaseIds', () => {
    const knowledgeRoot = () => join(userData, 'Data', 'KnowledgeBase')

    it('names the directory units that sit directly under the Knowledge root', () => {
      const ids = installedKnowledgeBaseIds(
        [entry('Data/KnowledgeBase/base-1'), entry('Data/KnowledgeBase/base-2')],
        userData,
        knowledgeRoot()
      )
      expect(ids).toEqual(['base-1', 'base-2'])
    })

    it('ignores units outside the Knowledge root, nested deeper, or not directories', () => {
      const ids = installedKnowledgeBaseIds(
        [entry('Data/Notes'), entry('Data/KnowledgeBase/base-1/nested'), entry('Data/KnowledgeBase/loose.txt', 'file')],
        userData,
        knowledgeRoot()
      )
      expect(ids).toEqual([])
    })
  })
})
