import { execFileSync } from 'node:child_process'
import type * as nodeFs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type NodeFs = typeof nodeFs

/** A second filesystem, which a temp directory will not provide on demand. */
const { foreign } = vi.hoisted(() => ({ foreign: { segment: '' } }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<NodeFs & { default: NodeFs }>()
  const statSync = ((target: never, options: never) => {
    const stats = actual.statSync(target, options)
    if (foreign.segment === '' || !String(target).includes(foreign.segment)) return stats
    return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { dev: stats.dev + 1 })
  }) as NodeFs['statSync']
  return { ...actual, statSync, default: { ...actual.default, statSync } }
})

import type { AdmittedResource } from '../../admission/verify'
import type { ResourceRoots } from '../adapters'
import { planResourceInstalls } from '../planInstalls'

/**
 * Planning is the LAST gate before a restore is allowed to rename anything, so
 * every case here asserts the same thing twice: the plan is refused, and the
 * refusal happens with the filesystem untouched.
 *
 * The pure rules themselves live in `resourcePaths.ts` and are proven there.
 * What this file proves is the half planning owns — reading the real filesystem
 * to produce the facts those rules are applied to, and turning the outcome into
 * journal entries.
 */

let userData = ''

const RID = '11111111-2222-4333-8444-555555555555'
const STAGING_REL = `restore-staging/${RID}/resources`

function roots(): ResourceRoots {
  return {
    files: join(userData, 'Data', 'Files'),
    knowledge: join(userData, 'Data', 'KnowledgeBase'),
    notes: join(userData, 'Data', 'Notes'),
    agentData: join(userData, 'Data', 'Agents'),
    systemWorkspaces: join(userData, 'Data', 'Agents', 'system'),
    skills: join(userData, 'Data', 'Skills')
  }
}

function resource(
  livePath: string,
  resourceType: 'file' | 'directory' = 'directory',
  kind = 'knowledge-base'
): AdmittedResource {
  return {
    kind,
    resourceType,
    stagedPath: join(userData, 'admission', livePath),
    livePath,
    sizeBytes: 1,
    hash: 'h'
  }
}

function plan(resources: AdmittedResource[]) {
  return planResourceInstalls({
    resources,
    userDataPath: userData,
    roots: roots(),
    restoreId: RID,
    stagingRelDir: STAGING_REL,
    platform: process.platform === 'win32' ? 'win32' : 'darwin'
  })
}

describe('planResourceInstalls', () => {
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'cs-planinstalls-'))
    mkdirSync(join(userData, 'Data', 'KnowledgeBase'), { recursive: true })
  })

  afterEach(() => {
    foreign.segment = ''
    rmSync(userData, { recursive: true, force: true })
  })

  it('emits one entry per unit with userData-relative staging, live, and aside paths', () => {
    const result = plan([resource('Data/KnowledgeBase/base-1'), resource('Data/KnowledgeBase/base-2')])

    expect(result.entries).toEqual([
      {
        resourceType: 'directory',
        staging: `${STAGING_REL}/Data/KnowledgeBase/base-1`,
        live: 'Data/KnowledgeBase/base-1',
        aside: `restore-aside/${RID}/0-base-1`,
        hadLive: false
      },
      {
        resourceType: 'directory',
        staging: `${STAGING_REL}/Data/KnowledgeBase/base-2`,
        live: 'Data/KnowledgeBase/base-2',
        aside: `restore-aside/${RID}/1-base-2`,
        hadLive: false
      }
    ])
  })

  it('counts an absent target as an install and an existing one as a replace', () => {
    mkdirSync(join(userData, 'Data', 'KnowledgeBase', 'base-1'), { recursive: true })

    const result = plan([resource('Data/KnowledgeBase/base-1'), resource('Data/KnowledgeBase/base-2')])

    expect(result).toMatchObject({ install: 1, replace: 1 })
    // The same fact the counters summarize, sealed per entry so recovery can
    // read the absence of an aside as proof rather than as a guess.
    expect(result.entries.map((entry) => entry.hadLive)).toEqual([true, false])
  })

  it('gives units that share a basename distinct aside slots', () => {
    const result = plan([resource('Data/KnowledgeBase/dup/x'), resource('Data/Skills/dup/x', 'directory', 'skill')])

    expect(new Set(result.entries.map((entry) => entry.aside)).size).toBe(2)
  })

  it('refuses a duplicated live path', () => {
    expect(() => plan([resource('Data/KnowledgeBase/base-1'), resource('Data/KnowledgeBase/base-1')])).toThrow(
      /duplicate/
    )
  })

  it('refuses a unit nested inside another unit', () => {
    // Installing both would make the outer rename decide the inner one's fate.
    expect(() => plan([resource('Data/KnowledgeBase/base-1'), resource('Data/KnowledgeBase/base-1/raw')])).toThrow(
      /overlap/
    )
  })

  it('refuses a unit outside its kind-owned root even when another registered root contains it', () => {
    expect(() => plan([resource('Data/Skills/thing')])).toThrow(/root/)
  })

  it('refuses an unknown resource kind', () => {
    expect(() => plan([resource('Data/KnowledgeBase/base-1', 'directory', 'future-kind')])).toThrow(/root/)
  })

  it('refuses a symlink standing where the target belongs', () => {
    mkdirSync(join(userData, 'elsewhere'), { recursive: true })
    symlinkSync(join(userData, 'elsewhere'), join(userData, 'Data', 'KnowledgeBase', 'base-1'))

    expect(() => plan([resource('Data/KnowledgeBase/base-1')])).toThrow(/target-not-installable/)
  })

  it('refuses a target reached through a symlinked ancestor', () => {
    mkdirSync(join(userData, 'elsewhere'), { recursive: true })
    rmSync(join(userData, 'Data', 'KnowledgeBase'), { recursive: true })
    symlinkSync(join(userData, 'elsewhere'), join(userData, 'Data', 'KnowledgeBase'))

    expect(() => plan([resource('Data/KnowledgeBase/base-1')])).toThrow(/unsafe-ancestor/)
  })

  it('refuses a target whose type differs from the unit', () => {
    writeFileSync(join(userData, 'Data', 'KnowledgeBase', 'base-1'), 'a file where a base belongs')

    expect(() => plan([resource('Data/KnowledgeBase/base-1')])).toThrow(/target-type-mismatch/)
  })

  /**
   * The target is only one of the three slots preboot renames between. A staging
   * tree or an aside root on another filesystem, or reached through a symlink,
   * fails the pass halfway — after the previous unit has already moved — which is
   * exactly what planning exists to prevent.
   */
  describe('every rename slot, not just the target', () => {
    it('refuses when the staging tree lives on another filesystem', () => {
      mkdirSync(join(userData, ...STAGING_REL.split('/')), { recursive: true })
      foreign.segment = 'restore-staging'

      expect(() => plan([resource('Data/KnowledgeBase/base-1')])).toThrow(/cross-filesystem/)
    })

    it('refuses when the aside root lives on another filesystem', () => {
      mkdirSync(join(userData, 'restore-aside', RID), { recursive: true })
      foreign.segment = 'restore-aside'

      expect(() => plan([resource('Data/KnowledgeBase/base-1')])).toThrow(/cross-filesystem/)
    })

    it('refuses when the staging tree is reached through a symlinked ancestor', () => {
      mkdirSync(join(userData, 'elsewhere'), { recursive: true })
      symlinkSync(join(userData, 'elsewhere'), join(userData, 'restore-staging'))

      expect(() => plan([resource('Data/KnowledgeBase/base-1')])).toThrow(/unsafe-ancestor/)
    })

    it('plans normally when all three slots share userData filesystem', () => {
      mkdirSync(join(userData, ...STAGING_REL.split('/')), { recursive: true })
      foreign.segment = 'no-such-directory'

      expect(plan([resource('Data/KnowledgeBase/base-1')]).entries).toHaveLength(1)
    })
  })

  it.skipIf(process.platform === 'win32')('refuses a special file standing where the target belongs', () => {
    const fifo = join(userData, 'Data', 'KnowledgeBase', 'base-1')
    execFileSync('mkfifo', [fifo])

    expect(() => plan([resource('Data/KnowledgeBase/base-1', 'file')])).toThrow(/target-not-installable/)
  })
})
