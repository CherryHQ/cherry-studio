import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CeilingsModule from '../../ceilings'

/**
 * The archive-wide entry ceiling, checked BEFORE the first payload byte is
 * copied (§5.3, §5.4). Publication enforces the same bound, but only once the
 * whole staging tree exists — so this file proves the preflight, not the
 * backstop.
 *
 * The real ceiling is 100,000 entries, which no test should materialize. The
 * ceilings module is narrowed instead, exactly as `publishArchiveWithCeilings`
 * lets publication tests hit boundaries without allocating GiB files. It is
 * narrowed to 7 (not 3) so the per-unit scanner limit — which reads the same
 * constant — still admits each unit on its own, and only the AGGREGATE trips.
 */
vi.mock('../../ceilings', async (importOriginal) => {
  const actual = await importOriginal<typeof CeilingsModule>()
  return {
    ...actual,
    BACKUP_CEILINGS: Object.freeze({ ...actual.BACKUP_CEILINGS, maxArchiveEntries: 7 })
  }
})

const { captureResourceStageBaseline, stageResources } = await import('../stageResources')
const { CeilingExceededError } = await import('../../errors')

describe('archive entry ceiling at the staging baseline', () => {
  let root = ''
  let userData = ''
  let resourcesDir = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-stage-entries-'))
    userData = join(root, 'userData')
    resourcesDir = join(root, 'staging', 'resources')
    mkdirSync(userData, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function writeSource(relPath: string, content = 'X'): void {
    const abs = join(userData, ...relPath.split('/'))
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }

  /** Two three-file bases: 3 fixed + 3 + 1 dir + 3 + 1 dir entries, over 7. */
  function seedTwoBases(): void {
    for (const base of ['kb-1', 'kb-2']) {
      for (const name of ['a.txt', 'b.txt', 'c.txt']) {
        writeSource(`Data/KnowledgeBase/${base}/raw/${name}`)
      }
    }
  }

  const bases = [
    { kind: 'knowledge-base', resourceType: 'directory' as const, livePath: 'Data/KnowledgeBase/kb-1' },
    { kind: 'knowledge-base', resourceType: 'directory' as const, livePath: 'Data/KnowledgeBase/kb-2' }
  ]

  it('counts the three fixed archive entries alongside the units', async () => {
    writeSource('Data/Files/blob.pdf')

    const baseline = await captureResourceStageBaseline({
      requirements: [{ kind: 'file-blob', resourceType: 'file', livePath: 'Data/Files/blob.pdf' }],
      userDataPath: userData
    })

    // `manifest.json` + `backup.sqlite` + the reserved `attestation.json` slot,
    // plus one payload.
    expect(baseline.entryCount).toBe(4)
  })

  it('refuses a profile whose units together exceed the ceiling', async () => {
    seedTwoBases()

    await expect(captureResourceStageBaseline({ requirements: bases, userDataPath: userData })).rejects.toBeInstanceOf(
      CeilingExceededError
    )
  })

  it('refuses before copying a single payload byte', async () => {
    seedTwoBases()

    await expect(stageResources({ requirements: bases, userDataPath: userData, resourcesDir })).rejects.toBeInstanceOf(
      CeilingExceededError
    )

    // Staging is where payload bytes land; it was never created.
    expect(existsSync(resourcesDir)).toBe(false)
  })

  it('does not charge the ceiling for a unit it excludes', async () => {
    seedTwoBases()

    // kb-1 cannot prove its material, so it is degraded out — and an omitted
    // unit ships no entries, which is what keeps the remaining profile legal.
    const result = await stageResources({
      requirements: bases,
      userDataPath: userData,
      resourcesDir,
      requiredContent: new Map([['Data/KnowledgeBase/kb-1', ['raw/gone.txt']]])
    })

    expect(result.payloads.map((payload) => payload.livePath)).toEqual(['Data/KnowledgeBase/kb-2'])
    expect(result.degradations[0].reason).toBe('unrebuildable-content')
  })
})
