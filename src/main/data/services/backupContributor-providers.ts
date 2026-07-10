// PROVIDERS backup contributor — owns `user_provider` + `user_model`.
//
// Co-located in the providers owning module (ProviderService / ModelService live
// in this flat data-services dir) per backup-architecture §7 placement.
// user_model is an include member of the user_provider aggregate via `providerId`
// (onDelete cascade). The domain is self-contained: no cross-domain FKs.
//
// natural-key identity: user_provider.providerId is the business identity (a stable
// provider key like 'openai'/'anthropic'), so cross-device merges line up without
// UUID collisions. conflictDefault derives to FIELD_MERGE (natural-key →
// FIELD_MERGE, §6.2) — column-level merge keeps the local API key and fills in
// fields only present remotely, preventing API key loss on restore.
//
// renamable:false — user_model.id is a derived key (NOT a stable cross-device
// identity; two devices generate different ids for the same provider+model pair).
// The real model identity is the UNIQUE(providerId, modelId) pair. A RENAME clone
// would have to re-derive model ids and rewrite every cross-domain FK that points
// at them (message.modelId, assistant.modelId, knowledge_base.embeddingModelId,
// etc.) — no safe clone path, so RENAME degrades to SKIP (architecture §3.5/§5).
//
// Preset: full + lite (configuration domain — users need their model service
// config + API keys on a new machine).

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * PROVIDERS domain. user_provider (natural-key providerId) is the aggregate root;
 * user_model (natural-key id, UNIQUE [providerId, modelId]) is an include member
 * via providerId. conflictDefault derives to FIELD_MERGE (natural-key →
 * FIELD_MERGE, §6.2). fieldMergePolicies keep local API keys and fill remote-only
 * credential columns; uniqueMergeRules merge models by the business unique pair.
 */
export const PROVIDERS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'PROVIDERS',
  schema: {
    tables: [table('user_provider'), table('user_model')],
    references: [
      // user_model.providerId → user_provider.providerId: same-domain owning
      // (cascade). Drives aggregate membership (#14/#15) and is #25-required.
      { table: table('user_model'), column: column('providerId'), referencedDomain: 'PROVIDERS', kind: 'owning' }
    ],
    primaryKeys: [mirrorPk('user_provider'), mirrorPk('user_model')],
    aggregates: [
      {
        root: table('user_provider'),
        identityKey: columns(['providerId']),
        members: [{ table: table('user_model'), viaColumn: column('providerId'), cascade: 'include' }],
        renamable: false
      }
    ],
    fileRefSourcePolicies: [],
    jsonSoftReferences: []
  },
  backupPolicy: {
    // Merge user_model by its non-PK business UNIQUE pair so a provider's models
    // line up across devices without colliding on the derived `id` PK.
    uniqueMergeRules: [{ table: table('user_model'), uniqueColumns: columns(['providerId', 'modelId']) }],
    // Credential columns: keep the local value and only fill from remote when local
    // is null/empty/default-skeleton. Seeded providers ship apiKeys=[] and non-null
    // authConfig skeletons, so a plain `remote-fills-local-null` would treat those as
    // "present" and silently drop backed-up credentials. `remote-fills-local-empty`
    // treats [], null, and empty/skeleton auth configs as missing — preserves a
    // working local API key, brings in keys present only in the backup (loss-
    // prevention for the API key). Restore (C/D track) implements the empty/skeleton detection.
    fieldMergePolicies: [
      {
        table: table('user_provider'),
        column: column('apiKeys'),
        strategy: 'remote-fills-local-empty'
      },
      {
        table: table('user_provider'),
        column: column('authConfig'),
        strategy: 'remote-fills-local-empty'
      }
    ]
  },
  operations: undefined
})
