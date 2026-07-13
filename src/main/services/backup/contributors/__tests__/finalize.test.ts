// Tests for finalize() — the 26 registry invariants — plus the ReadonlyBackupRegistry
// query surface and ContributorManager lazy/idempotent behavior.
//
// Strategy: a 14-domain synthetic fixture passes finalize cleanly (happy path);
// each invariant is then exercised by cloning the fixture and mutating the one
// declaration that should trip it. The fixture maps 14 domains onto 14 real
// tables (FK-free where possible) and covers all 4 FileRefSourceTypes, so it
// satisfies #1–#26 without the real B-track contributors.
import type {
  AggregateBoundary,
  BackupContributor,
  BackupContributorOperations,
  EntityReference,
  FileRefSourcePolicy,
  JsonSoftReferencePolicy,
  RowScope
} from '@main/data/db/backup/contributorTypes'
import {
  DB_JSON_COLUMNS,
  DB_PRIMARY_KEYS,
  type DbColumnName,
  type DbTableName,
  type PrimaryKeyFact
} from '@main/data/db/backup/dbSchemaRefs'
import { BACKUP_DOMAINS, type BackupDomain } from '@main/data/db/backup/domains'
import { KNOWLEDGE_CONTRIBUTOR } from '@main/data/services/backupContributorKnowledge'
import { describe, expect, it } from 'vitest'

import { ContributorFinalizeError } from '../ContributorFinalizeError'
import { ContributorManager } from '../ContributorManager'
import { finalize } from '../finalize'
import { READONLY_REGISTRY, ReadonlyBackupRegistryImpl } from '../ReadonlyBackupRegistryImpl'

// finalizedAt is fixed for determinism.
const META = { finalizedAt: '2026-06-27T00:00:00.000Z' }

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
): BackupContributor => {
  // Auto-exempt every JSON column on owned tables that is NOT a declared
  // jsonSoftReference, so the synthetic fixture satisfies #12(B) exhaustiveness
  // without each test spelling out exemptions (mirrors what real contributors do).
  const declaredJson = new Set((opts.jsonSoftReferences ?? []).map((j) => `${j.table}::${j.column}`))
  const exemptJsonCols = tables.flatMap((table) =>
    (DB_JSON_COLUMNS[table] ?? [])
      .filter((col) => !declaredJson.has(`${table}::${col}`))
      .map((col) => ({ table, column: col, reason: 'fixture: no soft refs' }))
  )
  return {
    domain,
    schema: {
      tables,
      references: opts.references ?? [],
      primaryKeys: tables.map(ownedPk),
      aggregates: opts.aggregates ?? [],
      fileRefSourcePolicies: opts.fileRefSourcePolicies ?? [],
      jsonSoftReferences: opts.jsonSoftReferences ?? [],
      exemptJsonCols,
      rowScopes: opts.rowScopes
    },
    backupPolicy: { uniqueMergeRules: [] },
    operations: opts.operations
  }
}

/** 14-domain fixture that satisfies every invariant. */
const buildFixture = (): BackupContributor[] => [
  contributor('PREFERENCES', ['preference']),
  contributor('PROVIDERS', ['user_provider'], {
    fileRefSourcePolicies: [{ sourceType: 'provider_logo', ownerDomain: 'PROVIDERS', resourcePolicy: 'include-with-owner' }]
  }),
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
  contributor('MINIAPPS', ['mini_app'], {
    fileRefSourcePolicies: [{ sourceType: 'mini_app_logo', ownerDomain: 'MINIAPPS', resourcePolicy: 'include-with-owner' }]
  }),
  contributor('SKILLS', ['agent_workspace']),
  contributor('TOPICS', ['note'], {
    fileRefSourcePolicies: [{ sourceType: 'chat_message', ownerDomain: 'TOPICS', resourcePolicy: 'include-with-owner' }]
  }),
  contributor('KNOWLEDGE', ['knowledge_base'], {
    references: [
      { table: 'knowledge_base', column: 'groupId', referencedDomain: 'TAGS_GROUPS', kind: 'optional' },
      { table: 'knowledge_base', column: 'embeddingModelId', referencedDomain: 'PROVIDERS', kind: 'optional' },
      { table: 'knowledge_base', column: 'rerankModelId', referencedDomain: 'PROVIDERS', kind: 'optional' }
    ]
    // post-#16532: knowledge_item is no longer a FileRefSourceType (knowledge files are
    // collected via collectFileResources, not FileManager refs), so KNOWLEDGE declares
    // no fileRefSourcePolicies. The fixture still covers allSourceTypes via temp_session
    // (AGENTS), chat_message (TOPICS), painting (PAINTINGS).
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
): BackupContributor[] =>
  list.map((c) => {
    if (c.domain !== domain) return c
    const merged = { ...c.schema, ...patch }
    // Recompute exemptJsonCols for the (possibly patched) tables + jsonSoftReferences
    // so #12(B) exhaustiveness stays satisfied after a patch — UNLESS the patch sets
    // exemptJsonCols explicitly (a #12 test that deliberately leaves columns uncovered).
    const declaredJson = new Set((merged.jsonSoftReferences ?? []).map((j) => `${j.table}::${j.column}`))
    const exemptJsonCols =
      patch.exemptJsonCols !== undefined
        ? patch.exemptJsonCols
        : (merged.tables ?? []).flatMap((table) =>
            (DB_JSON_COLUMNS[table] ?? [])
              .filter((col) => !declaredJson.has(`${table}::${col}`))
              .map((col) => ({ table, column: col, reason: 'fixture: no soft refs' }))
          )
    return { ...c, schema: { ...merged, exemptJsonCols } }
  })

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

  it('the real KNOWLEDGE_CONTRIBUTOR declaration passes finalize (knowledge_item aggregate boundary)', () => {
    // The synthetic fixture's KNOWLEDGE owns only knowledge_base; swap in the REAL
    // contributor so CI exercises the actual knowledge_item member + baseId owning ref
    // + 3 cross-domain FKs + composite self-FK coverage through every invariant — a
    // regression in the real declaration (e.g. a codegen FK change) fails here, not at
    // ContributorManager wiring time (which needs all 14 domains).
    const list = buildFixture().map((c) => (c.domain === 'KNOWLEDGE' ? KNOWLEDGE_CONTRIBUTOR : c))
    expect(() => finalize(list, META)).not.toThrow()
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

  it('#12 (A) rejects a jsonSoftReference declared on a non-JSON column', () => {
    // prompt.title is a real text column but NOT a JSON column (DB_JSON_COLUMNS.prompt
    // is empty). Declaring it as a jsonSoftReference closes the "json-ness trusted" hole:
    // codegen is the only trusted source of json-ness, so a non-JSON declaration is a bug.
    const list = patchSchema(buildFixture(), 'PROMPTS', {
      jsonSoftReferences: [
        {
          table: 'prompt',
          column: 'title',
          target: 'entity-id',
          ownerDomain: 'PROMPTS',
          kind: 'tolerant'
        }
      ]
    })
    expectInvariant(list, 12)
  })

  it('#12 (B) rejects an uncovered JSON column on an owned table', () => {
    // PROMPTS owns 'prompt' which has NO JSON columns, so declaring a jsonSoftReference
    // elsewhere is fine. Instead use MCP_SERVERS (owns mcp_server, which has 7 JSON
    // columns). Declare ONE jsonSoftReference (mcp_server.args) + one exemptJsonCol
    // (mcp_server.env). The remaining 5 JSON columns are uncovered → #12 (no opt-in
    // gate: exhaustiveness is unconditional on every owned JSON column).
    const list = patchSchema(buildFixture(), 'MCP_SERVERS', {
      jsonSoftReferences: [
        {
          table: 'mcp_server',
          column: 'args',
          target: 'entity-id',
          ownerDomain: 'MCP_SERVERS',
          kind: 'tolerant'
        }
      ],
      exemptJsonCols: [{ table: 'mcp_server', column: 'env', reason: 'struct-only' }]
    })
    expectInvariant(list, 12)
  })

  it('#12 (B) passes when every JSON column is declared or exempt', () => {
    // MCP_SERVERS: declare jsonSoftReferences for ALL 7 JSON columns → exhaustive → passes.
    const jsonCols = ['args', 'env', 'headers', 'tags', 'configSample', 'disabledTools', 'disabledAutoApproveTools']
    const list = patchSchema(buildFixture(), 'MCP_SERVERS', {
      jsonSoftReferences: jsonCols.map((col) => ({
        table: 'mcp_server' as DbTableName,
        column: col as DbColumnName<'mcp_server'>,
        target: 'entity-id' as const,
        ownerDomain: 'MCP_SERVERS' as BackupDomain,
        kind: 'tolerant' as const
      }))
    })
    expect(() => finalize(list, META)).not.toThrow()
  })

  it('#12 (B) exhaustiveness is satisfied by the fixture auto-exemptions', () => {
    // The contributor() helper auto-exempts every JSON column on owned tables that is
    // NOT a declared jsonSoftReference, so the default fixture passes #12(B)
    // unconditionally — there is no opt-in gate anymore (exhaustiveness is always on).
    expect(() => finalize(buildFixture(), META)).not.toThrow()
  })

  it('#13 rejects an aggregate root not owned by the domain', () => {
    // ASSISTANTS owns 'assistant'; an aggregate rooted at 'prompt' (owned by PROMPTS) → #13.
    expectInvariant(
      patchSchema(buildFixture(), 'ASSISTANTS', { aggregates: [{ root: 'prompt', renamable: false }] }),
      13
    )
  })

  it('#13 accepts a natural-key identityKey backed by a real UNIQUE constraint', () => {
    // tag.name has a UNIQUE index (codegen DB_UNIQUE_KEYS.tag); a natural-key
    // identityKey of ['name'] (≠ PK ['id']) is backed → passes #13.
    const list = patchSchema(buildFixture(), 'TAGS_GROUPS', {
      aggregates: [
        {
          root: 'tag',
          renamable: false,
          identityKey: ['name'],
          identityClass: 'natural-key',
          conflictDefault: 'FIELD_MERGE'
        }
      ]
    })
    expect(() => finalize(list, META)).not.toThrow()
  })

  it('#13 rejects a natural-key identityKey with no UNIQUE backing', () => {
    // assistant.name exists but has NO unique index (DB_UNIQUE_KEYS.assistant = []);
    // declaring it as a natural-key identityKey (≠ PK ['id']) is unbacked → #13.
    const list = patchSchema(buildFixture(), 'ASSISTANTS', {
      aggregates: [
        {
          root: 'assistant',
          renamable: false,
          identityKey: ['name'],
          identityClass: 'natural-key',
          conflictDefault: 'FIELD_MERGE'
        }
      ]
    })
    expectInvariant(list, 13)
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

  it('#26 rejects a renamable aggregate with a composite root PK', () => {
    // preference PK is composite [scope,key]; cloneAggregate is supplied so #16 passes,
    // but #26 rejects — newRootKey is a single value and cannot fill a composite PK.
    const list = buildFixture().map((c) =>
      c.domain === 'PREFERENCES'
        ? {
            ...c,
            schema: { ...c.schema, aggregates: [{ root: 'preference' as DbTableName, renamable: true }] },
            operations: { cloneAggregate: () => ({ rootRow: {} }) }
          }
        : c
    )
    expectInvariant(list, 26)
  })

  it('#26 allows a renamable aggregate with a single-column root PK', () => {
    // prompt PK is ['id'] (single column); renamable + cloneAggregate present → #16 and #26 both pass.
    const list = buildFixture().map((c) =>
      c.domain === 'PROMPTS'
        ? {
            ...c,
            schema: { ...c.schema, aggregates: [{ root: 'prompt' as DbTableName, renamable: true }] },
            operations: { cloneAggregate: () => ({ rootRow: {} }) }
          }
        : c
    )
    expect(() => finalize(list, META)).not.toThrow()
  })

  // NOTE: #19's restrict direction shares its branch with cascade (both → owning).
  // The current schema has zero `restrict` FKs, so the cascade-FK case below exercises
  // the same cascade/restrict → owning expectation. #20's two branches (junction +
  // non-cascade FK; optional + NOT NULL column without override) are guarded correctly
  // (see finalize.ts #19/#20) but unreachable through the real codegen: every optional-FK
  // column is nullable, and a junction on a non-cascade FK fails #19 first. They become
  // reachable once the schema grows a restrict / NOT-NULL optional FK.
  it('#19 rejects an owning kind on a set-null FK', () => {
    // assistant.modelId onDelete=set null → expected optional; declaring owning → #19.
    const list = patchSchema(buildFixture(), 'ASSISTANTS', {
      references: [{ table: 'assistant', column: 'modelId', referencedDomain: 'PROVIDERS', kind: 'owning' }]
    })
    expectInvariant(list, 19)
  })

  it('#19 rejects an optional kind on a cascade FK (cascade/restrict → owning direction)', () => {
    // KNOWLEDGE owns knowledge_item; knowledge_item.baseId onDelete=cascade → expected
    // owning. Declaring optional trips #19. This is the same branch a `restrict` FK would
    // exercise (cascade and restrict both map to owning); the real schema has no restrict
    // FK yet, so cascade stands in for it.
    const list = patchSchema(buildFixture(), 'KNOWLEDGE', {
      tables: ['knowledge_base', 'knowledge_item'],
      primaryKeys: [ownedPk('knowledge_base'), ownedPk('knowledge_item')],
      references: [{ table: 'knowledge_item', column: 'baseId', referencedDomain: 'KNOWLEDGE', kind: 'optional' }]
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

  it('#21 allows SKIP for a PREFERENCES natural-key aggregate (settings exception)', () => {
    // preference PK is composite (natural) → natural-key; PREFERENCES is the settings
    // exception, so SKIP is permitted (finalize invariant #21).
    const list = patchSchema(buildFixture(), 'PREFERENCES', {
      aggregates: [{ root: 'preference', renamable: false, conflictDefault: 'SKIP' }]
    })
    expect(() => finalize(list, META)).not.toThrow()
  })

  it('platformSpecificKeys: rejects a non-PREFERENCES contributor declaring keys', () => {
    // Only PREFERENCES may declare platformSpecificKeys (architecture §6.1). PROMPTS
    // declaring one is a deviation — fail invariant 21 with a clear payload.
    const list = patchPolicy(buildFixture(), 'PROMPTS', {
      platformSpecificKeys: ['shortcut.*']
    })
    expectInvariant(list, 21)
  })

  it('platformSpecificKeys: rejects a malformed glob', () => {
    // A glob with an illegal character (space) or unbalanced brackets is malformed.
    // PREFERENCES is the rightful owner, so only the glob check trips here.
    const list = patchPolicy(buildFixture(), 'PREFERENCES', {
      platformSpecificKeys: ['short cut.*']
    })
    expectInvariant(list, 21)
  })

  it('platformSpecificKeys: rejects a glob with unbalanced brackets', () => {
    const list = patchPolicy(buildFixture(), 'PREFERENCES', {
      platformSpecificKeys: ['shortcut[abc']
    })
    expectInvariant(list, 21)
  })

  it('platformSpecificKeys: accepts legal globs on PREFERENCES', () => {
    const list = patchPolicy(buildFixture(), 'PREFERENCES', {
      platformSpecificKeys: ['shortcut.*', '*.path', 'theme[12]']
    })
    expect(() => finalize(list, META)).not.toThrow()
  })

  it('polymorphicEntityMap: rejects a value that is neither a known domain nor "excluded"', () => {
    // TAGS_GROUPS owns the polymorphic tables; declaring a map with a bogus target
    // ('NO_SUCH_DOMAIN') must fail — Record<EntityType,...> is compile-time exhaustive
    // over keys, so the runtime check validates VALUES only.
    const list = patchSchema(buildFixture(), 'TAGS_GROUPS', {
      polymorphicEntityMap: {
        assistant: 'TAGS_GROUPS',
        topic: 'NO_SUCH_DOMAIN' as BackupDomain,
        model: 'excluded',
        agent: 'excluded',
        knowledge: 'excluded',
        session: 'excluded'
      }
    })
    expectInvariant(list, 21)
  })

  it('polymorphicEntityMap: accepts a map whose values are all known domains or "excluded"', () => {
    const list = patchSchema(buildFixture(), 'TAGS_GROUPS', {
      polymorphicEntityMap: {
        assistant: 'ASSISTANTS',
        topic: 'TOPICS',
        model: 'PROVIDERS',
        agent: 'AGENTS',
        knowledge: 'KNOWLEDGE',
        session: 'excluded'
      }
    })
    expect(() => finalize(list, META)).not.toThrow()
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

  it('#23 rejects a typeCoverage that marks the filter-selected type as "excluded"', () => {
    // A rowScope filters job_schedule.type='agent.task' and marks that same type
    // 'excluded' in typeCoverage — the filter selects those rows (they belong here by
    // construction), so excluding them is an inconsistency that would drop them silently.
    const list = patchSchema(buildFixture(), 'AGENTS', {
      rowScopes: [
        {
          table: 'job_schedule',
          ownerDomain: 'AGENTS',
          filter: { column: 'type', op: 'eq', value: 'agent.task' },
          typeCoverage: { 'agent.task': 'excluded' } as unknown as never
        }
      ]
    })
    expectInvariant(list, 23)
  })

  it('#23 accepts a consistent typeCoverage', () => {
    // The filter-selected type is 'owned' (consistent with the filter selecting it); any
    // other JobType can be 'owned' or 'excluded'. Record<JobType,...> is compile-time
    // exhaustive over keys, so the runtime check validates VALUES + filter consistency.
    const list = patchSchema(buildFixture(), 'AGENTS', {
      rowScopes: [
        {
          table: 'job_schedule',
          ownerDomain: 'AGENTS',
          filter: { column: 'type', op: 'eq', value: 'agent.task' },
          typeCoverage: { 'agent.task': 'owned' } as unknown as never
        }
      ]
    })
    expect(() => finalize(list, META)).not.toThrow()
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
