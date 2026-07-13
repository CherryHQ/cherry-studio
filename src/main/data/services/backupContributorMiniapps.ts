// MINIAPPS backup contributor — owns the `mini_app` table.
//
// Co-located in the miniapps owning module (MiniAppService / MiniAppSeeder live in
// this flat data-services dir) per backup-architecture §7 placement. Single-table
// schema-only domain: no cross-domain FKs (presetMiniAppId points at an app-builtin
// preset, NOT a DB row — §5.4 scalar-ID three-way rule: non-DB resource → not an
// EntityReference candidate), no aggregate members, no file-ref / JSON soft refs,
// no operations hooks.
//
// Preset: full + lite (lite includes miniapps — small config rows).

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * MINIAPPS domain: user miniapp configurations keyed by the natural `appId` PK.
 * Per §6.2 identityClass derives to natural-key (PK kind natural), conflictDefault
 * to FIELD_MERGE (aligns the same app across devices). renamable:false — a natural
 * single-column PK clone would collide on the same appId, RENAME degrades to SKIP.
 */
export const MINIAPPS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'MINIAPPS',
  schema: {
    tables: [table('mini_app')],
    references: [],
    primaryKeys: [mirrorPk('mini_app')],
    aggregates: [
      {
        root: table('mini_app'),
        identityKey: columns(['appId']),
        members: [],
        renamable: false
      }
    ],
    // mini_app_logo single-file ref (mini_app_logo_file_ref.sourceId → mini_app):
    // MINIAPPS owns the sourceType so finalize #11 (FileRefSourceType coverage) passes.
    // Logo blob staging follows the full single-file-ref backup track (follow-up).
    fileRefSourcePolicies: [
      { sourceType: 'mini_app_logo', ownerDomain: 'MINIAPPS', resourcePolicy: 'include-with-owner', sourceTable: table('mini_app') }
    ],
    jsonSoftReferences: [],
    // mini_app JSON columns hold config/region data — no embedded fileId/entityId
    // soft refs. Declared so finalize #12 exhaustiveness passes.
    exemptJsonCols: [
      {
        table: table('mini_app'),
        column: column('supportedRegions'),
        reason: 'no soft refs — holds list of supported region codes'
      },
      {
        table: table('mini_app'),
        column: column('configuration'),
        reason: 'no soft refs — holds miniapp runtime configuration'
      }
    ]
  },
  backupPolicy: {},
  // Schema-only: no file resources, no row transform, no restoreResources.
  operations: undefined
})
