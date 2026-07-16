// Unit tests for the SKILLS contributor — pure declaration assertions (no DB)
// + a DB-backed collect suite (zip/local skill-dir capture, TBD-1 (iii) lite degraded).
import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import type {
  ExportResourceDegradation,
  FileResourceContext,
  ReadonlyBackupRegistry
} from '@main/data/db/backup/contributorTypes'
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { agentGlobalSkillTable } from '@main/data/db/schemas/agentGlobalSkill'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SKILLS_CONTRIBUTOR } from '../backupContributorSkills'

describe('SKILLS contributor', () => {
  it('owns exactly agent_global_skill (NOT agent_skill, which belongs to AGENTS)', () => {
    expect(SKILLS_CONTRIBUTOR.schema.tables).toEqual([table('agent_global_skill')])
  })

  it('identityKey is the UNIQUE folderName (natural-key, not the uuid PK)', () => {
    const aggregate = SKILLS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('agent_global_skill'))
    expect(aggregate.identityKey).toEqual(['folderName'])
    expect(aggregate.identityClass).toBe('natural-key')
    expect(aggregate.conflictDefault).toBe('FIELD_MERGE')
    expect(aggregate.members).toEqual([])
    expect(aggregate.renamable).toBe(false)
  })

  it('agent_global_skill primary key is uuid-v4 and non-ambiguous', () => {
    const primaryKey = SKILLS_CONTRIBUTOR.schema.primaryKeys.find((fact) => fact.table === 'agent_global_skill')
    expect(primaryKey).toBeDefined()
    expect(primaryKey!.kind).toBe('uuid-v4')
    expect(primaryKey!.ambiguous).toBeFalsy()
  })

  it('has no references, file-ref policies, or JSON soft-refs', () => {
    expect(SKILLS_CONTRIBUTOR.schema.references).toEqual([])
    expect(SKILLS_CONTRIBUTOR.schema.fileRefSourcePolicies).toEqual([])
    expect(SKILLS_CONTRIBUTOR.schema.jsonSoftReferences).toEqual([])
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(SKILLS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})

describe('SKILLS contributor collectFileResources', () => {
  const dbh = setupTestDatabase()

  // Seed one skill per source — only zip/local are non-re-downloadable (must archive).
  // beforeEach (not beforeAll): setupTestDatabase is per-test, so seeding once at the
  // describe top would be reset before each it.
  beforeEach(async () => {
    await dbh.db.insert(agentGlobalSkillTable).values([
      { id: 's1', folderName: 'zipSkill', name: 'z', source: 'zip', contentHash: 'hz', isEnabled: true },
      { id: 's2', folderName: 'localSkill', name: 'l', source: 'local', contentHash: 'hl', isEnabled: true },
      {
        id: 's3',
        folderName: 'marketSkill',
        name: 'm',
        source: 'marketplace',
        sourceUrl: 'https://x',
        contentHash: 'hm',
        isEnabled: true
      },
      { id: 's4', folderName: 'builtinSkill', name: 'b', source: 'builtin', contentHash: 'hb', isEnabled: true }
    ])
  })

  const makeCtx = (
    preset: 'full' | 'lite',
    recordDegraded: (item: ExportResourceDegradation) => void
  ): FileResourceContext =>
    ({
      liveDb: new BackupReadonlyDb(dbh.db),
      registry: {} as ReadonlyBackupRegistry,
      restoreId: 'test',
      domains: ['SKILLS'],
      strategy: 'SKIP',
      preset,
      recordDegraded,
      notesRoot: undefined
    }) as FileResourceContext

  it('full: emits skill-dir only for zip/local skills (not marketplace/builtin)', async () => {
    const rd = vi.fn()
    const descs = await SKILLS_CONTRIBUTOR.operations!.collectFileResources!(makeCtx('full', rd))
    // collect returns only skill-dir here (zip/local); narrow for the folderName sort.
    const skillDirs = descs.filter(
      (d): d is { kind: 'skill-dir'; folderName: string; contentHash: string } => d.kind === 'skill-dir'
    )
    expect(skillDirs.sort((a, b) => a.folderName.localeCompare(b.folderName))).toEqual([
      { kind: 'skill-dir', folderName: 'localSkill', contentHash: 'hl' },
      { kind: 'skill-dir', folderName: 'zipSkill', contentHash: 'hz' }
    ])
    expect(rd).not.toHaveBeenCalled()
  })

  it('lite: records degraded for zip/local (observable, never silent), emits no descriptor', async () => {
    const rd = vi.fn()
    const descs = await SKILLS_CONTRIBUTOR.operations!.collectFileResources!(makeCtx('lite', rd))
    expect(descs).toEqual([])
    expect(rd).toHaveBeenCalledWith({ kind: 'skill-dir-omitted-lite', folderName: 'zipSkill', contentHash: 'hz' })
    expect(rd).toHaveBeenCalledWith({ kind: 'skill-dir-omitted-lite', folderName: 'localSkill', contentHash: 'hl' })
    expect(rd).toHaveBeenCalledTimes(2)
  })
})
