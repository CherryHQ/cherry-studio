import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CeilingsModule from '../../ceilings'

/**
 * The archive-wide entry ceiling is accumulated from owner-scoped resource
 * cuts. A unit that would cross it is omitted with an explicit degradation;
 * previously captured units remain usable.
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

const { stageResources } = await import('../stageResources')

describe('archive entry ceiling during owner-scoped staging', () => {
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

  it('reserves the three fixed archive entries alongside payloads', async () => {
    writeSource('Data/Files/blob.pdf')

    const result = await stageResources({
      requirements: [{ kind: 'file-blob', resourceType: 'file', livePath: 'Data/Files/blob.pdf' }],
      userDataPath: userData,
      resourcesDir
    })

    expect(result.payloads).toHaveLength(1)
    expect(result.degradations).toEqual([])
  })

  it('keeps earlier units and degrades the unit that crosses the ceiling', async () => {
    seedTwoBases()

    const result = await stageResources({ requirements: bases, userDataPath: userData, resourcesDir })

    expect(result.payloads.map((payload) => payload.livePath)).toEqual(['Data/KnowledgeBase/kb-1'])
    expect(result.degradations).toContainEqual({
      kind: 'resource:knowledge-base',
      livePath: 'Data/KnowledgeBase/kb-2',
      reason: 'resource-ceiling-exceeded'
    })
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
