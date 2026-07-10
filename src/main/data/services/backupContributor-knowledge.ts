// KNOWLEDGE backup contributor — owns `knowledge_base` + `knowledge_item`.
//
// Co-located in the knowledge owning module (KnowledgeBaseService, the table CRUD
// owner, lives in this flat data-services dir) per backup-architecture §7 placement.
// knowledge_item is an include member of the knowledge_base aggregate via `baseId`
// (onDelete cascade). knowledge_base has 3 cross-domain OPTIONAL FKs: groupId→group
// (set null), embeddingModelId/rerankModelId→user_model. knowledge_item additionally
// carries a composite self-FK [baseId,groupId]→[baseId,id] (parent→expanded-child
// within one base); finalize #25 covers it via the any-column rule (baseId declared).
//
// Post-#16532: knowledge files no longer register FileManager refs (knowledge_item is
// NOT a FileRefSourceType — removed from the union), so this contributor declares no
// fileRefSourcePolicies. Knowledge file blobs are collected via collectFileResources
// (filesystem {baseId}/ directory), not via FileManager refs.
//
// renamable:false — the {baseId}/ directory + .cherry/index.sqlite must stay
// consistent with the base id; a RENAME clone cannot guarantee that, so RENAME
// degrades to SKIP (architecture §3.5).
//
// Preset: full only (lite-excluded — knowledge bases are large).

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * KNOWLEDGE domain. knowledge_base (uuid-v4) is the aggregate root; knowledge_item
 * (uuid-v7) is an include member via baseId. conflictDefault derives to SKIP
 * (uuid-entity → SKIP, §6.2).
 */
export const KNOWLEDGE_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'KNOWLEDGE',
  schema: {
    tables: [table('knowledge_base'), table('knowledge_item')],
    references: [
      // knowledge_item.baseId → knowledge_base: same-domain owning (cascade). Drives
      // the aggregate membership (#14/#15) and is #25-required (declared so the
      // composite self-FK [baseId,groupId] is also covered by the any-column rule).
      { table: table('knowledge_item'), column: column('baseId'), referencedDomain: 'KNOWLEDGE', kind: 'owning' },
      // knowledge_base.groupId → group (TAGS_GROUPS): optional (onDelete set null). #25-required.
      { table: table('knowledge_base'), column: column('groupId'), referencedDomain: 'TAGS_GROUPS', kind: 'optional' },
      // knowledge_base.embeddingModelId → user_model (PROVIDERS): optional (onDelete
      // defaults to no action → optional). #25-required.
      {
        table: table('knowledge_base'),
        column: column('embeddingModelId'),
        referencedDomain: 'PROVIDERS',
        kind: 'optional'
      },
      // knowledge_base.rerankModelId → user_model (PROVIDERS): optional (onDelete set null).
      {
        table: table('knowledge_base'),
        column: column('rerankModelId'),
        referencedDomain: 'PROVIDERS',
        kind: 'optional'
      }
    ],
    primaryKeys: [mirrorPk('knowledge_base'), mirrorPk('knowledge_item')],
    aggregates: [
      {
        root: table('knowledge_base'),
        identityKey: columns(['id']),
        members: [{ table: table('knowledge_item'), viaColumn: column('baseId'), cascade: 'include' }],
        renamable: false
      }
    ],
    fileRefSourcePolicies: [],
    jsonSoftReferences: []
  },
  backupPolicy: {},
  // TODO(C/D track): collectFileResources (export the {baseId}/ directory — raw source
  // files + .cherry/index.sqlite) + restoreResources (copy verbatim, no reindex on
  // restore since the embedded index is part of the base). Not a finalize concern;
  // wired with the C/D restore track.
  operations: undefined
})
