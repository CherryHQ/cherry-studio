import type * as nodeFs from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  installResourceUnits,
  recoverResourceUnits,
  resourceInstallDurability
} from '@data/db/restore/resourceInstallV2'
import type { ResourceInstallEntry } from '@data/db/restore/restoreJournalV2'
import type { RecoveryPhase } from '@data/db/restore/restoreRecovery'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type NodeFs = typeof nodeFs

/** The one fault a real filesystem will not produce on demand: a cross-device rename. */
const { crossDevice, foreign } = vi.hoisted(() => ({ crossDevice: { on: false }, foreign: { segment: '' } }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<NodeFs & { default: NodeFs }>()
  const renameSync: NodeFs['renameSync'] = (source, target) => {
    if (!crossDevice.on) return actual.renameSync(source, target)
    const error = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException
    error.code = 'EXDEV'
    throw error
  }
  // The other half of the same fault, visible BEFORE any rename is attempted:
  // a slot whose nearest existing ancestor reports a different device.
  const statSync = ((target: never, options: never) => {
    const stats = actual.statSync(target, options)
    if (foreign.segment === '' || !String(target).includes(foreign.segment)) return stats
    return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { dev: stats.dev + 1 })
  }) as NodeFs['statSync']
  return { ...actual, renameSync, statSync, default: { ...actual.default, renameSync, statSync } }
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
    foreign.segment = ''
    vi.restoreAllMocks()
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

    it('flushes the parent entries that create a new aside directory', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.staging, 'ARCHIVE')
      makeDirUnit(unit.live, 'TARGET')
      const synced: string[] = []
      vi.spyOn(resourceInstallDurability, 'syncDirectory').mockImplementation((dir) => synced.push(dir))

      installResourceUnits([unit], userData)

      expect(synced).toContain(abs('restore-aside'))
      expect(synced).toContain(abs(`restore-aside/${RID}`))
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

    it('refuses a symlink substituted for the staged source after preparation', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit('outside', 'ARCHIVE')
      mkdirSync(join(abs(unit.staging), '..'), { recursive: true })
      symlinkSync(abs('outside'), abs(unit.staging))

      expect(() => installResourceUnits([unit], userData)).toThrow(/recovery-source-invalid/)
      expect(readUnit('outside')).toBe('ARCHIVE')
      expect(existsSync(abs(unit.live))).toBe(false)
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

    it('fails closed when staging is missing even if an old live target exists', () => {
      const unit = entry('Data/KnowledgeBase/base-1')
      makeDirUnit(unit.live, 'TARGET')

      expect(() => installResourceUnits([unit], userData)).toThrow(/staged-missing/)
      expect(readUnit(unit.live)).toBe('TARGET')
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

    /**
     * The contract's promise is to fail BEFORE any mutation, so the fault always
     * sits on the SECOND unit here: the assertion that matters is that the first
     * unit — the one a per-unit check would have moved already — is untouched.
     */
    describe('proving every slot before the first rename', () => {
      function twoUnits(): ResourceInstallEntry[] {
        const units = [
          { ...entry('Data/KnowledgeBase/base-1'), hadLive: true },
          { ...entry('Data/KnowledgeBase/base-2'), hadLive: false }
        ]
        makeDirUnit(units[0].staging, 'A1')
        makeDirUnit(units[0].live, 'T1')
        makeDirUnit(units[1].staging, 'A2')
        return units
      }

      function expectNothingMoved(units: readonly ResourceInstallEntry[]): void {
        expect(readUnit(units[0].live)).toBe('T1')
        expect(readUnit(units[0].staging)).toBe('A1')
        expect(existsSync(abs(units[0].aside))).toBe(false)
      }

      it('refuses when a later unit reaches its target through a symlinked ancestor', () => {
        const units = twoUnits()
        mkdirSync(abs('elsewhere'), { recursive: true })
        rmSync(abs('Data/KnowledgeBase'), { recursive: true })
        mkdirSync(abs('Data'), { recursive: true })
        symlinkSync(abs('elsewhere'), abs('Data/KnowledgeBase'))

        expect(() => installResourceUnits(units, userData)).toThrow(/unsafe-ancestor/)
        expect(existsSync(abs('elsewhere/base-1'))).toBe(false)
      })

      it('refuses when the staging tree turns out to be on another filesystem', () => {
        const units = twoUnits()
        foreign.segment = 'restore-staging'

        expect(() => installResourceUnits(units, userData)).toThrow(/cross-filesystem/)
        expectNothingMoved(units)
      })

      it('refuses when the aside root turns out to be on another filesystem', () => {
        const units = twoUnits()
        mkdirSync(abs(`restore-aside/${RID}`), { recursive: true })
        foreign.segment = 'restore-aside'

        expect(() => installResourceUnits(units, userData)).toThrow(/cross-filesystem/)
        expectNothingMoved(units)
      })

      it('refuses when a later staged source is missing', () => {
        const units = twoUnits()
        rmSync(abs(units[1].staging), { recursive: true })

        expect(() => installResourceUnits(units, userData)).toThrow(/staged-missing/)
        expectNothingMoved(units)
      })

      it('refuses when a later staged source changed type', () => {
        const units = twoUnits()
        rmSync(abs(units[1].staging), { recursive: true })
        makeFileUnit(units[1].staging, 'NOT-A-DIRECTORY')

        expect(() => installResourceUnits(units, userData)).toThrow(/recovery-source-invalid/)
        expectNothingMoved(units)
      })

      it('refuses when a later live target changed type', () => {
        const units = twoUnits()
        makeFileUnit(units[1].live, 'NOT-A-DIRECTORY')

        expect(() => installResourceUnits(units, userData)).toThrow(/target-type-mismatch/)
        expectNothingMoved(units)
      })

      it('refuses when a later aside is occupied', () => {
        const units = twoUnits()
        makeDirUnit(units[1].aside, 'OLDER-ASIDE')

        expect(() => installResourceUnits(units, userData)).toThrow(/aside-occupied/)
        expectNothingMoved(units)
      })

      it('refuses when a later target appeared after arm sealed it absent', () => {
        const units = twoUnits()
        makeDirUnit(units[1].live, 'LATE-TARGET')

        expect(() => installResourceUnits(units, userData)).toThrow(/target-presence-changed/)
        expectNothingMoved(units)
      })

      it('refuses when a later target disappeared after arm sealed it present', () => {
        const units = twoUnits()
        units[1] = { ...units[1], hadLive: true }

        expect(() => installResourceUnits(units, userData)).toThrow(/target-presence-changed/)
        expectNothingMoved(units)
      })

      it('refuses a rollback pass on the same proof, before it undoes anything', () => {
        const units = twoUnits()
        installResourceUnits(units, userData)
        foreign.segment = 'restore-staging'

        expect(() => recoverResourceUnits(units, userData, 'pre-commit')).toThrow(/cross-filesystem/)
        expect(readUnit(units[0].live)).toBe('A1')
        expect(readUnit(units[0].aside)).toBe('T1')
      })
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
})
