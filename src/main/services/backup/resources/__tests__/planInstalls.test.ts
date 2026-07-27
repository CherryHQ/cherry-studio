import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
    workspaces: join(userData, 'Data', 'Agents'),
    skills: join(userData, 'Data', 'Skills')
  }
}

function resource(livePath: string, resourceType: 'file' | 'directory' = 'directory'): AdmittedResource {
  return {
    kind: 'knowledge-base',
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
    rmSync(userData, { recursive: true, force: true })
  })

  it('emits one entry per unit with userData-relative staging, live, and aside paths', () => {
    const result = plan([resource('Data/KnowledgeBase/base-1'), resource('Data/KnowledgeBase/base-2')])

    expect(result.entries).toEqual([
      {
        resourceType: 'directory',
        staging: `${STAGING_REL}/Data/KnowledgeBase/base-1`,
        live: 'Data/KnowledgeBase/base-1',
        aside: `restore-aside/${RID}/0-base-1`
      },
      {
        resourceType: 'directory',
        staging: `${STAGING_REL}/Data/KnowledgeBase/base-2`,
        live: 'Data/KnowledgeBase/base-2',
        aside: `restore-aside/${RID}/1-base-2`
      }
    ])
  })

  it('counts an absent target as an install and an existing one as a replace', () => {
    mkdirSync(join(userData, 'Data', 'KnowledgeBase', 'base-1'), { recursive: true })

    const result = plan([resource('Data/KnowledgeBase/base-1'), resource('Data/KnowledgeBase/base-2')])

    expect(result).toMatchObject({ install: 1, replace: 1 })
  })

  it('gives units that share a basename distinct aside slots', () => {
    const result = plan([resource('Data/KnowledgeBase/dup/x'), resource('Data/Skills/dup/x')])

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

  it('refuses a unit outside every registered root', () => {
    expect(() => plan([resource('Data/Unregistered/thing')])).toThrow(/root/)
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

  it.skipIf(process.platform === 'win32')('refuses a special file standing where the target belongs', () => {
    const fifo = join(userData, 'Data', 'KnowledgeBase', 'base-1')
    execFileSync('mkfifo', [fifo])

    expect(() => plan([resource('Data/KnowledgeBase/base-1', 'file')])).toThrow(/target-not-installable/)
  })
})
