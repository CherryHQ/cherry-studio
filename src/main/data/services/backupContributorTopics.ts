// TOPICS backup contributor — owns `topic` + `message` + `chat_message_file_ref`.
//
// Co-located in the topics owning module (TopicService / MessageService, the table
// CRUD owners, live in this flat data-services dir) per backup-architecture §7
// placement. The topic aggregate is renamable: RENAME on id conflict clones the
// topic AND its message tree (and chat_message_file_ref rows), and cloneAggregate
// must additionally rewrite the `topic.activeNodeId` scalar soft ref to the cloned
// message's new id (architecture §5.3 — required, not optional).
//
// Post-#16532 the old polymorphic `file_ref` was split; `chat_message_file_ref`
// (FK sourceId→message cascade + fileEntryId→file_entry cascade) belongs to TOPICS
// by source domain. It is an include member (via sourceId→message), not a junction
// reference, because its TOPICS-side leg (sourceId) remaps with the message tree on
// clone; the FILE_STORAGE leg (fileEntryId) is declared as a junction reference.
//
// message.data carries a tolerant fileEntryId JSON soft ref (attachments). The
// `chat_message` FileRefSourceType is owned here (include-with-owner) so file blobs
// follow chat messages in full backups.
//
// Preset: full + lite (chat history is a core migrate scenario).

import type { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'
import { chatMessageFileRefTable } from '@main/data/db/schemas/fileRelations'

/**
 * TOPICS domain. topic (uuid-v4) is the aggregate root; message (uuid-v7) is an
 * include member via topicId (onDelete cascade); chat_message_file_ref (uuid-v4) is
 * a nested include member via sourceId→message (onDelete cascade). conflictDefault
 * derives to SKIP (uuid-entity → SKIP, §6.2).
 *
 * message.parentId is a self-FK (message→message, cascade). It is declared owning
 * to satisfy #19 (cascade→owning) and #25 (every FK declared), but does NOT enter
 * the aggregate members: it targets `message` (the member table), not the root
 * `topic`, so #14 excludes it from member derivation.
 *
 * topic.activeNodeId is a scalar text soft ref to a message id with NO FK. It is
 * not an EntityReference (#24 requires a FK); instead cloneAggregate rewrites it to
 * the cloned message's new id (§5.3) on RENAME.
 */
/**
 * Collect fileEntryIds referenced by chat_message_file_ref (deduped). These ids
 * point at file_entry rows (owned by FILE_STORAGE); the junction has no deletedAt
 * (deletion cascades from message/file_entry), so no filter here — staging
 * resolves each id against file_entry and skips soft-deleted / missing sources.
 */
export async function collectChatMessageFileIds(liveDb: BackupReadonlyDb): Promise<Set<string>> {
  const rows = await liveDb.select().from(chatMessageFileRefTable)
  return new Set(rows.map((r) => r.fileEntryId))
}

export const TOPICS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'TOPICS',
  schema: {
    tables: [table('topic'), table('message'), table('chat_message_file_ref')],
    references: [
      // message.topicId → topic: same-domain owning (cascade). Drives aggregate
      // membership (#14/#15) and is #25-required.
      { table: table('message'), column: column('topicId'), referencedDomain: 'TOPICS', kind: 'owning' },
      // message.parentId → message: self-FK (cascade). Declared owning per #19/#25,
      // but excluded from members (#14: targets the member, not the root).
      { table: table('message'), column: column('parentId'), referencedDomain: 'TOPICS', kind: 'owning' },
      // message.modelId → user_model (PROVIDERS): optional (onDelete set null). #25-required.
      { table: table('message'), column: column('modelId'), referencedDomain: 'PROVIDERS', kind: 'optional' },
      // chat_message_file_ref.sourceId → message: same-domain owning (cascade), nested
      // include member (file refs follow their owning message on clone/prune).
      {
        table: table('chat_message_file_ref'),
        column: column('sourceId'),
        referencedDomain: 'TOPICS',
        kind: 'owning'
      },
      // chat_message_file_ref.fileEntryId → file_entry (FILE_STORAGE): cross-domain
      // junction (cascade-prune with FILE_STORAGE).
      {
        table: table('chat_message_file_ref'),
        column: column('fileEntryId'),
        referencedDomain: 'FILE_STORAGE',
        kind: 'junction'
      },
      // topic.assistantId → assistant (ASSISTANTS): optional (onDelete set null). #25-required.
      { table: table('topic'), column: column('assistantId'), referencedDomain: 'ASSISTANTS', kind: 'optional' },
      // topic.groupId → group (TAGS_GROUPS): optional (onDelete set null). #25-required.
      { table: table('topic'), column: column('groupId'), referencedDomain: 'TAGS_GROUPS', kind: 'optional' }
    ],
    primaryKeys: [mirrorPk('topic'), mirrorPk('message'), mirrorPk('chat_message_file_ref')],
    aggregates: [
      {
        root: table('topic'),
        identityKey: columns(['id']),
        members: [
          { table: table('message'), viaColumn: column('topicId'), cascade: 'include' },
          {
            table: table('chat_message_file_ref'),
            viaColumn: column('sourceId'),
            // Nested member: chat_message_file_ref.sourceId points at message (the
            // parent member), not the root topic — declare parent to disambiguate
            // (#14/#15 multi-owning-ref rule).
            parent: table('message'),
            cascade: 'include'
          }
        ],
        renamable: true
      }
    ],
    fileRefSourcePolicies: [
      // chat_message file refs are owned by TOPICS (source domain) and bundled with
      // the topic/message tree in full backups (#11 coverage).
      {
        sourceType: 'chat_message',
        ownerDomain: 'TOPICS',
        resourcePolicy: 'include-with-owner',
        sourceTable: table('message')
      }
    ],
    jsonSoftReferences: [
      // message.data embeds attachment fileEntryId soft refs (tolerant — missing blob
      // degrades to a toast + orphan check, no identity propagation, §5.4).
      {
        table: table('message'),
        column: column('data'),
        target: 'file-ref',
        ownerDomain: 'TOPICS',
        kind: 'tolerant'
      }
    ],
    // message JSON columns that carry NO soft refs (data IS a jsonSoftReference —
    // NOT exempt). Declared so finalize #12 exhaustiveness passes.
    exemptJsonCols: [
      {
        table: table('message'),
        column: column('modelSnapshot'),
        reason: 'no soft refs — holds a frozen snapshot of the model config at send time'
      },
      { table: table('message'), column: column('stats'), reason: 'no soft refs — holds token/usage statistics' }
    ]
  },
  backupPolicy: {},
  operations: {
    // Export blob set = chat_message_file_ref.fileEntryId (deduped). Staging
    // resolves each id + skips soft-deleted / missing sources (chat attachments
    // follow their owning message in full backups, contributor-spec §5a / backup-architecture §5).
    collectFileResources: (ctx) => collectChatMessageFileIds(ctx.liveDb),
    // Renamable aggregate (RENAME on conflict) → cloneAggregate is required (#16).
    // Pure: no db on the context. The root PK column is read from the registry
    // (#26 guarantees a single-column root PK). The importer remaps member rows
    // (message.id, chat_message_file_ref.sourceId/fileEntryId) via memberKeyMap.
    // Additionally, topic.activeNodeId is a scalar soft ref to a message id with no
    // FK (§5.3): on RENAME it MUST be rewritten to the cloned message's new id, or
    // the restored topic points at the old aggregate's node / dangles.
    cloneAggregate: (ctx) => {
      const pkColumn = ctx.registry.getPrimaryKey(ctx.aggregate.root).columns[0]
      // Map old message id → cloned message id from the importer's memberKeyMap, and
      // rewrite activeNodeId so the renamed topic points inside its own clone.
      const messageKeyMap = ctx.memberKeyMap.get(table('message'))
      const oldActiveNodeId = ctx.rootRow.activeNodeId
      const newActiveNodeId =
        typeof oldActiveNodeId === 'string' && messageKeyMap ? messageKeyMap.get(oldActiveNodeId) : undefined
      return {
        rootRow: {
          ...ctx.rootRow,
          [pkColumn]: ctx.newRootKey,
          // Rewrite the scalar soft ref; if activeNodeId is null or its message was
          // not cloned (e.g. absent from backup), clear it rather than dangle.
          activeNodeId: newActiveNodeId ?? null
        }
      }
    }
  }
})
