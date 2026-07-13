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
    tables: [table('user_provider'), table('user_model'), table('provider_logo_file_ref')],
    references: [
      // user_model.providerId → user_provider.providerId: same-domain owning
      // (cascade). Drives aggregate membership (#14/#15) and is #25-required.
      { table: table('user_model'), column: column('providerId'), referencedDomain: 'PROVIDERS', kind: 'owning' },
      // provider_logo_file_ref.sourceId → user_provider.providerId: same-domain owning
      // (cascade). The logo ref follows its provider on clone/prune (single-file ref).
      { table: table('provider_logo_file_ref'), column: column('sourceId'), referencedDomain: 'PROVIDERS', kind: 'owning' },
      // provider_logo_file_ref.fileEntryId → file_entry (FILE_STORAGE): cross-domain
      // junction (cascade-prune with FILE_STORAGE, mirrors chat_message_file_ref).
      { table: table('provider_logo_file_ref'), column: column('fileEntryId'), referencedDomain: 'FILE_STORAGE', kind: 'junction' }
    ],
    primaryKeys: [mirrorPk('user_provider'), mirrorPk('user_model'), mirrorPk('provider_logo_file_ref')],
    aggregates: [
      {
        root: table('user_provider'),
        identityKey: columns(['providerId']),
        members: [
          { table: table('user_model'), viaColumn: column('providerId'), cascade: 'include' },
          {
            table: table('provider_logo_file_ref'),
            viaColumn: column('sourceId'),
            // sourceId → user_provider (root) — direct member, parent is the root.
            parent: table('user_provider'),
            cascade: 'include'
          }
        ],
        renamable: false
      }
    ],
    // provider_logo single-file ref (provider_logo_file_ref.sourceId → user_provider):
    // PROVIDERS owns the sourceType so finalize #11 (FileRefSourceType coverage) passes.
    // Logo blob staging follows the full single-file-ref backup track (follow-up).
    fileRefSourcePolicies: [
      { sourceType: 'provider_logo', ownerDomain: 'PROVIDERS', resourcePolicy: 'include-with-owner', sourceTable: table('user_provider') }
    ],
    jsonSoftReferences: [],
    // Every JSON column on user_provider/user_model is structural config — none
    // carry cross-entity soft refs (no embedded fileId / entityId). Declared here
    // so finalize #12 exhaustiveness is satisfied (every JSON column is either a
    // jsonSoftReference or listed here with a reason).
    exemptJsonCols: [
      // ── user_provider ──────────────────────────────────────────────────────
      // Credentials — merged via fieldMergePolicies (remote-fills-local-empty),
      // NOT jsonSoftReferences: they hold secrets, not entity links.
      {
        table: table('user_provider'),
        column: column('apiKeys'),
        reason:
          'holds encrypted API key credentials, merged via fieldMergePolicies (remote-fills-local-empty), not a soft ref'
      },
      {
        table: table('user_provider'),
        column: column('authConfig'),
        reason:
          'holds OAuth/credential config, merged via fieldMergePolicies (remote-fills-local-empty), not a soft ref'
      },
      // Structural provider config — no embedded entity/file ids.
      {
        table: table('user_provider'),
        column: column('endpointConfigs'),
        reason: 'no soft refs — holds per-endpoint base URL / route config'
      },
      {
        table: table('user_provider'),
        column: column('apiFeatures'),
        reason: 'no soft refs — holds provider capability feature flags'
      },
      {
        table: table('user_provider'),
        column: column('providerSettings'),
        reason: 'no soft refs — holds miscellaneous provider settings'
      },
      // ── user_model ─────────────────────────────────────────────────────────
      {
        table: table('user_model'),
        column: column('capabilities'),
        reason: 'no soft refs — holds model capability flags (vision/tools/etc.)'
      },
      {
        table: table('user_model'),
        column: column('inputModalities'),
        reason: 'no soft refs — holds accepted input modality list'
      },
      {
        table: table('user_model'),
        column: column('outputModalities'),
        reason: 'no soft refs — holds produced output modality list'
      },
      {
        table: table('user_model'),
        column: column('endpointTypes'),
        reason: 'no soft refs — holds supported endpoint type list'
      },
      {
        table: table('user_model'),
        column: column('reasoning'),
        reason: 'no soft refs — holds reasoning-effort config'
      },
      {
        table: table('user_model'),
        column: column('parameters'),
        reason: 'no soft refs — holds default sampling parameters'
      },
      { table: table('user_model'), column: column('pricing'), reason: 'no soft refs — holds per-token pricing tiers' },
      {
        table: table('user_model'),
        column: column('userOverrides'),
        reason: 'no soft refs — holds user overrides on top of preset model config'
      }
    ]
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
