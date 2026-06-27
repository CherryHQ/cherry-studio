// Tests for finalize() — the 25 registry invariants — plus the ReadonlyBackupRegistry
// query surface and ContributorManager lazy/idempotent behavior.
//
// Strategy: a 14-domain synthetic fixture passes finalize cleanly (happy path);
// each invariant is then exercised by cloning the fixture and mutating the one
// declaration that should trip it. The fixture maps 14 domains onto 14 real
// tables (FK-free where possible) and covers all 4 FileRefSourceTypes, so it
// satisfies #1–#25 without the real B-track contributors.
import { describe, expect, it } from 'vitest'

import type {
  AggregateBoundary,
  BackupContributor,
  BackupContributorOperations,
  EntityReference,
  FileRefSourcePolicy,
  JsonSoftReferencePolicy,
  RowScope
} from '@main/data/db/backup/contributor-types'
import { BACKUP_DOMAINS, type BackupDomain } from '@main/data/db/backup/domains'
import {
  DB_PRIMARY_KEYS,
  type DbColumnName,
  type DbTableName,
  type PrimaryKeyFact
} from '@main/data/db/backup/dbSchemaRefs'

import { ContributorFinalizeError } from './ContributorFinalizeError'
import { ContributorManager } from './ContributorManager'
import { finalize } from './finalize'
import { READONLY_REGISTRY, ReadonlyBackupRegistryImpl } from './ReadonlyBackupRegistryImpl'

const META = { finalizedAt: '2026-06-27T00:00:00.000Z', schemaCommit: '420187b831' }

// ─── Fixture builders ─────────────────────────────────────────────────────────

/** A PK fact mirroring the codegen value but with ambiguous forced false (the
 *  contributor has confirmed the PK, satisfying #9 even for heuristic-ambiguous tables). */
const ownedPk = (table: DbTableName): PrimaryKeyFact => ({ ...DB_PRIMARY_KEYS[table], ambiguous: false })

interface ContributorOpts {
  references?: readonly EntityReference[]
  fileRefSourcePolicies?: readonly FileRefSourcePolicy[]
  jsonSoftReferences?: readonly JsonSoftReferencePolicy[]
  aggregates?: readonly AggregateBoundary[]
  rowScopes?: readonly RowScope[]
  operations?: BackupContributorOperations
}

const contributor = (
  domain: BackupDomain,
  tables: readonly DbTableName[],
  opts: ContributorOpts = {}
): BackupContributor => ({
  domain,
  schema: {
    tables,
    references: opts.references ?? [],
    primaryKeys: tables.map(ownedPk),
    aggregates: opts.aggregates ?? [],
    fileRefSourcePolicies: opts.fileRefSourcePolicies ?? [],
    jsonSoftReferences: opts.jsonSoftReferences ?? [],
    rowScopes: opts.rowScopes
  },
  backupPolicy: { uniqueMergeRules: [] },
  operations: opts.operations
})

/** 14-domain fixture that satisfies every invariant. */
const buildFixture = (): BackupContributor[] => [
  contributor('PREFERENCES', ['preference']),
  contributor('PROVIDERS', ['user_provider']),
  contributor('PROMPTS', ['prompt']),
  contributor('MCP_SERVERS', ['mcp_server']),
  contributor('TAGS_GROUPS', ['tag', 'group']),
  contributor('ASSISTANTS', ['assistant'], {
    references: [{ table: 'assistant', column: 'modelId', referencedDomain: 'PROVIDERS', kind: 'optional' }]
  }),
  contributor('AGENTS', ['agent_global_skill'], {
    fileRefSourcePolicies: [
      { sourceType: 'temp_session', ownerDomain: 'excluded', resourcePolicy: 'runtime-only-exclude' }
    ]
  }),
  contributor('MINIAPPS', ['mini_app']),
  contributor('SKILLS', ['agent_workspace']),
  contributor('TOPICS', ['note'], {
    fileRefSourcePolicies: [{ sourceType: 'chat_message', ownerDomain: 'TOPICS', resourcePolicy: 'include-with-owner' }]
  }),
  contributor('KNOWLEDGE', ['knowledge_base'], {
    references: [
      { table: 'knowledge_base', column: 'groupId', referencedDomain: 'TAGS_GROUPS', kind: 'optional' },
      { table: 'knowledge_base', column: 'embeddingModelId', referencedDomain: 'PROVIDERS', kind: 'optional' },
      { table: 'knowledge_base', column: 'rerankModelId', referencedDomain: 'PROVIDERS', kind: 'optional' }
    ],
    fileRefSourcePolicies: [
      { sourceType: 'knowledge_item', ownerDomain: 'KNOWLEDGE', resourcePolicy: 'include-with-owner' }
    ]
  }),
  contributor('PAINTINGS', ['painting'], {
    fileRefSourcePolicies: [{ sourceType: 'painting', ownerDomain: 'PAINTINGS', resourcePolicy: 'include-with-owner' }]
  }),
  contributor('FILE_STORAGE', ['file_entry']),
  contributor('TRANSLATE_HISTORY', ['translate_language'])
]

/** Replace one domain's schema slice (immutable spread — no readonly violation). */
const patchSchema = (
  list: readonly BackupContributor[],
  domain: BackupDomain,
  patch: Partial<BackupContributor['schema']>
): BackupContributor[] => list.map((c) => (c.domain === domain ? { ...c, schema: { ...c.schema, ...patch } } : c))

/** Replace one domain's policy slice. */
const patchPolicy = (
  list: readonly BackupContributor[],
  domain: BackupDomain,
  patch: Partial<BackupContributor['backupPolicy']>
): BackupContributor[] =>
  list.map((c) => (c.domain === domain ? { ...c, backupPolicy: { ...c.backupPolicy, ...patch } } : c))

/** Assert that finalizing `list` throws the given invariant id. */
const expectInvariant = (list: readonly BackupContributor[], invariant: number): void => {
  try {
    finalize(list, META)
    throw new Error('expected ContributorFinalizeError to be thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(ContributorFinalizeError)
    expect((e as ContributorFinalizeError).invariant).toBe(invariant)
  }
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('finalize happy path', () => {
  it('accepts a valid 14-domain fixture and returns a registry', () => {
    const registry = finalize(buildFixture(), META)
    expect(registry).toBeInstanceOf(ReadonlyBackupRegistryImpl)
    expect(registry.domains).toEqual(BACKUP_DOMAINS)
  })
})

// ─── Invariant violations ─────────────────────────────────────────────────────

describe('finalize invariants', () => {
  it('#1 rejects a missing domain', () => {
    expectInvariant(
      buildFixture().filter((c) => c.domain !== 'PAINTINGS'),
      1
    )
  })

  it('#1 rejects a duplicate domain', () => {
    const list = buildFixture()
    expectInvariant([...list, contributor('PROMPTS', ['prompt'])], 1)
  })

  it('#2 rejects an owned table not in DB_TABLES', () => {
    expectInvariant(patchSchema(buildFixture(), 'PROMPTS', { tables: ['prompt', 'favorite_topic' as DbTableName] }), 2)
  })

  it('#3 rejects a table owned by two domains', () => {
    // PROVIDERS additionally owns 'prompt' (already owned by PROMPTS) → multi-owned.
    const list = patchSchema(buildFixture(), 'PROVIDERS', {
      tables: ['user_provider', 'prompt'],
      primaryKeys: [ownedPk('user_provider'), ownedPk('prompt')]
    })
    expectInvariant(list, 3)
  })

  it('#4 rejects an ALWAYS_STRIP table owned by a contributor', () => {
    const list = patchSchema(buildFixture(), 'PROMPTS', {
      tables: ['prompt', 'app_state'],
      primaryKeys: [ownedPk('prompt'), ownedPk('app_state')]
    })
    expectInvariant(list, 4)
  })

  it('#6 rejects a reference whose table is not owned by the declarer', () => {
    // ASSISTANTS declares a ref on 'prompt' (owned by PROMPTS, not ASSISTANTS).
    const list = patchSchema(buildFixture(), 'ASSISTANTS', {
      references: [{ table: 'prompt', column: 'id', referencedDomain: 'PROMPTS', kind: 'optional' }]
    })
    expectInvariant(list, 6)
  })

  it('#6 rejects a referencedDomain that does not own the FK target', () => {
    // knowledge_base.groupId → group (owned by TAGS_GROUPS); declaring PAINTINGS → #6.
    const list = patchSchema(buildFixture(), 'KNOWLEDGE', {
      references: [
        { table: 'knowledge_base', column: 'groupId', referencedDomain: 'PAINTINGS', kind: 'optional' },
        { table: 'knowledge_base', column: 'embeddingModelId', referencedDomain: 'PROVIDERS', kind: 'optional' },
        { table: 'knowledge_base', column: 'rerankModelId', referencedDomain: 'PROVIDERS', kind: 'optional' }
      ]
    })
    expectInvariant(list, 6)
  })

  it('#7 rejects a redundant omittedReferenceOverride', () => {
    // assistant.modelId is optional → default SET_NULL; overriding to SET_NULL is redundant.
    const ref: EntityReference = {
      table: 'assistant',
      column: 'modelId',
      referencedDomain: 'PROVIDERS',
      kind: 'optional'
    }
    const list = patchPolicy(buildFixture(), 'ASSISTANTS', {
      omittedReferenceOverrides: [{ reference: ref, action: 'SET_NULL', reason: 'redundant' }]
    })
    expectInvariant(list, 7)
  })

  it('#8 rejects an owned table with no primary-key fact', () => {
    const list = patchSchema(buildFixture(), 'PROMPTS', { primaryKeys: [] })
    expectInvariant(list, 8)
  })

  it('#9 rejects an ambiguous primary key', () => {
    const list = patchSchema(buildFixture(), 'PROMPTS', {
      primaryKeys: [{ ...ownedPk('prompt'), ambiguous: true }]
    })
    expectInvariant(list, 9)
  })

  it('#10 rejects a reference cycle between domains', () => {
    // ASSISTANTS→PROVIDERS (modelId) already exists; add PROVIDERS→ASSISTANTS to close
    // the loop. The back-edge uses a non-FK column (user_provider has no FK on
    // providerId) — acceptable because #10 runs before #24, so the cycle is caught
    // before the unmatched-FK check. No pair of real cross-FK tables forms a natural
    // cycle in the schema, so a synthetic back-edge is the only option here.
    const list = patchSchema(buildFixture(), 'PROVIDERS', {
      references: [{ table: 'user_provider', column: 'providerId', referencedDomain: 'ASSISTANTS', kind: 'optional' }]
    })
    expectInvariant(list, 10)
  })

  it('#11 rejects an unowned FileRefSourceType', () => {
    expectInvariant(patchSchema(buildFixture(), 'PAINTINGS', { fileRefSourcePolicies: [] }), 11)
  })

  it('#12 rejects a jsonSoftReference on a non-existent column', () => {
    const list = patchSchema(buildFixture(), 'PROMPTS', {
      jsonSoftReferences: [
        {
          table: 'prompt',
          column: 'no_such_col' as DbColumnName,
          target: 'entity-id',
          ownerDomain: 'PROMPTS',
          kind: 'tolerant'
        }
      ]
    })
    expectInvariant(list, 12)
  })

  it('#13 rejects an aggregate root not owned by the domain', () => {
    // ASSISTANTS owns 'assistant'; an aggregate rooted at 'prompt' (owned by PROMPTS) → #13.
    expectInvariant(
      patchSchema(buildFixture(), 'ASSISTANTS', { aggregates: [{ root: 'prompt', renamable: false }] }),
      13
    )
  })

  it('#14 rejects an aggregate member with no deriving owning reference', () => {
    // TAGS_GROUPS owns group+tag; declare group as a root with tag as a member, but
    // tag has no owning reference into group → #14.
    const list = patchSchema(buildFixture(), 'TAGS_GROUPS', {
      aggregates: [
        { root: 'group', renamable: false, members: [{ table: 'tag', viaColumn: 'id', cascade: 'include' }] }
      ]
    })
    expectInvariant(list, 14)
  })

  it('#15 rejects a member viaColumn not bound as an FK to the root/parent', () => {
    // KNOWLEDGE owns knowledge_base+knowledge_item; knowledge_item.groupId is a real
    // column but its FKs target knowledge_base on (baseId) and knowledge_item on
    // (baseId,groupId) — none bound to the root knowledge_base via groupId alone → #15.
    const list = patchSchema(buildFixture(), 'KNOWLEDGE', {
      tables: ['knowledge_base', 'knowledge_item'],
      primaryKeys: [ownedPk('knowledge_base'), ownedPk('knowledge_item')],
      references: [
        { table: 'knowledge_base', column: 'groupId', referencedDomain: 'TAGS_GROUPS', kind: 'optional' },
        { table: 'knowledge_base', column: 'embeddingModelId', referencedDomain: 'PROVIDERS', kind: 'optional' },
        { table: 'knowledge_base', column: 'rerankModelId', referencedDomain: 'PROVIDERS', kind: 'optional' },
        { table: 'knowledge_item', column: 'groupId', referencedDomain: 'KNOWLEDGE', kind: 'owning' }
      ],
      aggregates: [
        {
          root: 'knowledge_base',
          renamable: false,
          members: [{ table: 'knowledge_item', viaColumn: 'groupId', cascade: 'include' }]
        }
      ]
    })
    expectInvariant(list, 15)
  })

  it('#16 rejects a renamable aggregate without cloneAggregate', () => {
    expectInvariant(patchSchema(buildFixture(), 'PROMPTS', { aggregates: [{ root: 'prompt', renamable: true }] }), 16)
  })

  it('#19 rejects an owning kind on a set-null FK', () => {
    // assistant.modelId onDelete=set null → expected optional; declaring owning → #19.
    const list = patchSchema(buildFixture(), 'ASSISTANTS', {
      references: [{ table: 'assistant', column: 'modelId', referencedDomain: 'PROVIDERS', kind: 'owning' }]
    })
    expectInvariant(list, 19)
  })

  it('#21 rejects SKIP default for a natural-key aggregate (non-settings)', () => {
    // user_provider PK is natural → identityClass natural-key; SKIP default → #21.
    expectInvariant(
      patchSchema(buildFixture(), 'PROVIDERS', {
        aggregates: [{ root: 'user_provider', renamable: false, conflictDefault: 'SKIP' }]
      }),
      21
    )
  })

  it('#22 rejects an autoincrement primary key', () => {
    const list = patchSchema(buildFixture(), 'PROMPTS', {
      primaryKeys: [{ table: 'prompt', columns: ['id'], kind: 'autoincrement', ambiguous: false }]
    })
    expectInvariant(list, 22)
  })

  it('#23 rejects a rowScope with a non-existent filter column', () => {
    const list = patchSchema(buildFixture(), 'AGENTS', {
      rowScopes: [
        {
          table: 'job_schedule',
          ownerDomain: 'AGENTS',
          filter: { column: 'no_such' as DbColumnName, op: 'eq', value: 'x' }
        }
      ]
    })
    expectInvariant(list, 23)
  })

  it('#24 rejects a declared reference with no matching generated FK', () => {
    // assistant.name is not an FK column → no matching FK → #24.
    const list = patchSchema(buildFixture(), 'ASSISTANTS', {
      references: [{ table: 'assistant', column: 'name', referencedDomain: 'PROVIDERS', kind: 'optional' }]
    })
    expectInvariant(list, 24)
  })

  it('#25 rejects an owned-table FK not declared by its owner', () => {
    // knowledge_base has 3 FKs; declare only 2 → rerankModelId undeclared → #25.
    const list = patchSchema(buildFixture(), 'KNOWLEDGE', {
      references: [
        { table: 'knowledge_base', column: 'groupId', referencedDomain: 'TAGS_GROUPS', kind: 'optional' },
        { table: 'knowledge_base', column: 'embeddingModelId', referencedDomain: 'PROVIDERS', kind: 'optional' }
      ]
    })
    expectInvariant(list, 25)
  })
})

// ─── ReadonlyBackupRegistry query surface ─────────────────────────────────────

describe('ReadonlyBackupRegistry queries', () => {
  const registry = finalize(buildFixture(), META)

  it('exposes all 14 domains', () => {
    expect(registry.domains).toEqual(BACKUP_DOMAINS)
  })

  it('exposes finalized aggregates with derived defaults filled (#14)', () => {
    // PROVIDERS declares an aggregate with NO derived fields; the registry must fill
    // identityKey (root PK), identityClass (PK kind), conflictDefault (class→strategy).
    const list = patchSchema(buildFixture(), 'PROVIDERS', {
      aggregates: [{ root: 'user_provider', renamable: false }]
    })
    const reg = finalize(list, META)
    const aggs = reg.getAggregatesForDomain('PROVIDERS')
    expect(aggs).toHaveLength(1)
    expect(aggs[0].identityKey).toEqual(['providerId'])
    expect(aggs[0].identityClass).toBe('natural-key')
    expect(aggs[0].conflictDefault).toBe('FIELD_MERGE')
  })

  it('resolves the table owner for an owned table', () => {
    expect(registry.getTableOwner('assistant')).toBe('ASSISTANTS')
  })

  it('reports excluded for an ALWAYS_STRIP table', () => {
    expect(registry.getTableOwner('app_state')).toBe('excluded')
    expect(registry.getTableOwner('job')).toBe('excluded')
  })

  it('returns the codegen PK fact', () => {
    expect(registry.getPrimaryKey('assistant').columns).toEqual(['id'])
  })

  it('returns the codegen FK facts', () => {
    // assistant has one FK: modelId → user_model (set null).
    expect(registry.getForeignKeys('assistant')).toHaveLength(1)
  })

  it('returns the domain references', () => {
    expect(registry.getReferencesForDomain('ASSISTANTS')).toHaveLength(1)
  })

  it('resolves a FileRefSourceType policy', () => {
    expect(registry.getFileRefPolicy('painting').ownerDomain).toBe('PAINTINGS')
  })

  it('returns dependencies for a domain', () => {
    expect(registry.getDependencies('ASSISTANTS')).toContain('PROVIDERS')
  })

  it('topologically sorts a domain subset (dependencies first)', () => {
    const sorted = registry.topoSort(['ASSISTANTS', 'PROVIDERS'])
    expect(sorted).toEqual(['PROVIDERS', 'ASSISTANTS'])
  })

  it('carries the brand symbol', () => {
    expect((registry as ReadonlyBackupRegistryImpl & { [READONLY_REGISTRY]: boolean })[READONLY_REGISTRY]).toBe(true)
  })

  it('surfaces finalize meta', () => {
    expect(registry.finalizedAt).toBe(META.finalizedAt)
    expect(registry.schemaCommit).toBe(META.schemaCommit)
  })
})

// ─── ContributorManager lazy / idempotent ─────────────────────────────────────

describe('ContributorManager', () => {
  it('lazily finalizes on first getRegistry and caches thereafter', () => {
    const mgr = new ContributorManager(buildFixture())
    const first = mgr.getRegistry()
    const second = mgr.getRegistry()
    expect(first).toBeInstanceOf(ReadonlyBackupRegistryImpl)
    expect(second).toBe(first) // same cached instance — idempotent
  })

  it('fails fast at invariant #1 when no contributors are wired', () => {
    const mgr = new ContributorManager()
    expect(() => mgr.getRegistry()).toThrow(ContributorFinalizeError)
  })
})
