// TAGS_GROUPS backup contributor — owns `tag`, `entity_tag`, `group`, `pin`.
//
// Co-located in the tagging owning module (GroupService / PinService live in
// this flat data-services dir) per backup-architecture §7 placement. All
// aggregates are single-table and non-renamable: tag/group/pin are referenced by
// the polymorphic `entity_tag` (composite [entityType, entityId, tagId]) and
// `pin` tables — a RENAME clone would leave those polymorphic soft-refs pointing
// at the old id (architecture §5.2: cross-aggregate polymorphic soft-refs are NOT
// remapped), so RENAME degrades to SKIP.
//
// `entity_tag` is owned but intentionally NOT an aggregate member (polymorphic
// junction; #25 exempts it from FK-declaration, #14 does not derive it as a
// member when members is explicitly []). Its `tagId → tag` same-domain owning FK
// is declared for documentation + identity-propagation clarity.
//
// Preset: full + lite.

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * TAGS_GROUPS domain. `tag` (UNIQUE name) and `pin` (UNIQUE [entityType,entityId])
 * are natural-key → FIELD_MERGE; `group` (no business UNIQUE) is uuid-entity →
 * SKIP (derived). `entity_tag` has no aggregate of its own.
 */
export const TAGS_GROUPS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'TAGS_GROUPS',
  schema: {
    tables: [table('tag'), table('entity_tag'), table('group'), table('pin')],
    references: [
      // entity_tag.tagId → tag.id: same-domain owning FK (cascade). Declared for
      // identity-propagation clarity even though #25 exempts entity_tag.
      { table: table('entity_tag'), column: column('tagId'), referencedDomain: 'TAGS_GROUPS', kind: 'owning' }
    ],
    primaryKeys: [mirrorPk('tag'), mirrorPk('entity_tag'), mirrorPk('group'), mirrorPk('pin')],
    aggregates: [
      {
        root: table('tag'),
        identityKey: columns(['name']),
        identityClass: 'natural-key',
        conflictDefault: 'FIELD_MERGE',
        members: [],
        renamable: false
      },
      {
        root: table('group'),
        identityKey: columns(['id']),
        identityClass: 'uuid-entity',
        conflictDefault: 'SKIP',
        members: [],
        renamable: false
      },
      {
        root: table('pin'),
        identityKey: columns(['entityType', 'entityId']),
        identityClass: 'natural-key',
        conflictDefault: 'FIELD_MERGE',
        members: [],
        renamable: false
      }
    ],
    fileRefSourcePolicies: [],
    jsonSoftReferences: []
  },
  backupPolicy: {},
  // TODO(C/D track): selected-domain filtering for the polymorphic tables (codex
  // review P2). pin.entityId / entity_tag.entityId point polymorphically (by
  // entityType) into topics/sessions/knowledge/file/painting. In lite restore —
  // TAGS_GROUPS included while KNOWLEDGE/FILE_STORAGE/PAINTINGS are excluded — the
  // importer MUST drop pin/entity_tag rows whose target domain is omitted, else
  // tags/pins attach to non-existent entities; the entityType→domain mapping must
  // be exhaustive (a coverage/finalize check, plus selected-domain filtering on
  // restore). Not a finalize concern; wired with the
  // C/D restore track.
  operations: undefined
})
