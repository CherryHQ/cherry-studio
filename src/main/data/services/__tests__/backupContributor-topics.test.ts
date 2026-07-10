// Unit tests for the TOPICS contributor — pure declaration assertions (no DB).
import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import type { CloneAggregateContext } from '@main/data/db/backup/contributorTypes'
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { chatMessageFileRefTable } from '@main/data/db/schemas/fileRelations'
import { messageTable } from '@main/data/db/schemas/message'
import { topicTable } from '@main/data/db/schemas/topic'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { collectChatMessageFileIds, TOPICS_CONTRIBUTOR } from '../backupContributor-topics'

describe('TOPICS contributor', () => {
  it('owns topic + message + chat_message_file_ref', () => {
    expect(TOPICS_CONTRIBUTOR.schema.tables).toEqual([table('topic'), table('message'), table('chat_message_file_ref')])
  })

  it('declares 7 references: topicId/parentId owning + sourceId owning + modelId/assistantId/groupId optional + fileEntryId junction', () => {
    const refs = TOPICS_CONTRIBUTOR.schema.references
    expect(refs).toHaveLength(7)
    // message.topicId → topic: same-domain owning, drives aggregate membership.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('message'),
        column: 'topicId',
        referencedDomain: 'TOPICS',
        kind: 'owning'
      })
    )
    // message.parentId → message: self-FK owning (cascade), excluded from members.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('message'),
        column: 'parentId',
        referencedDomain: 'TOPICS',
        kind: 'owning'
      })
    )
    // message.modelId → user_model (PROVIDERS): optional.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('message'),
        column: 'modelId',
        referencedDomain: 'PROVIDERS',
        kind: 'optional'
      })
    )
    // chat_message_file_ref.sourceId → message: same-domain owning (nested member).
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('chat_message_file_ref'),
        column: 'sourceId',
        referencedDomain: 'TOPICS',
        kind: 'owning'
      })
    )
    // chat_message_file_ref.fileEntryId → file_entry: cross-domain junction.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('chat_message_file_ref'),
        column: 'fileEntryId',
        referencedDomain: 'FILE_STORAGE',
        kind: 'junction'
      })
    )
    // topic.assistantId → assistant (ASSISTANTS): optional.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('topic'),
        column: 'assistantId',
        referencedDomain: 'ASSISTANTS',
        kind: 'optional'
      })
    )
    // topic.groupId → group (TAGS_GROUPS): optional.
    expect(refs).toContainEqual(
      expect.objectContaining({
        table: table('topic'),
        column: 'groupId',
        referencedDomain: 'TAGS_GROUPS',
        kind: 'optional'
      })
    )
  })

  it('topic aggregate is renamable with message(topicId) + chat_message_file_ref(sourceId→message) include members', () => {
    const aggregate = TOPICS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.root).toBe(table('topic'))
    expect(aggregate.identityKey).toEqual(['id'])
    expect(aggregate.renamable).toBe(true)
    expect(aggregate.members).toEqual([
      expect.objectContaining({ table: table('message'), viaColumn: 'topicId', cascade: 'include' }),
      // Nested member: parent=message disambiguates the sourceId→message leg.
      expect.objectContaining({
        table: table('chat_message_file_ref'),
        viaColumn: 'sourceId',
        parent: table('message'),
        cascade: 'include'
      })
    ])
  })

  it('identity key is the single-column topic PK (uniqueness for cross-device match)', () => {
    const aggregate = TOPICS_CONTRIBUTOR.schema.aggregates[0]
    expect(aggregate.identityKey).toEqual(['id'])
    // Single-column root PK satisfies finalize #26 (renamable root PK is single).
    expect(aggregate.identityKey).toHaveLength(1)
  })

  it('declares chat_message FileRefSourceType owned by TOPICS (include-with-owner)', () => {
    const policies = TOPICS_CONTRIBUTOR.schema.fileRefSourcePolicies
    expect(policies).toHaveLength(1)
    expect(policies[0]).toEqual(
      expect.objectContaining({
        sourceType: 'chat_message',
        ownerDomain: 'TOPICS',
        resourcePolicy: 'include-with-owner',
        sourceTable: table('message')
      })
    )
  })

  it('declares message.data as a tolerant file-ref JSON soft reference', () => {
    const softRefs = TOPICS_CONTRIBUTOR.schema.jsonSoftReferences
    expect(softRefs).toHaveLength(1)
    expect(softRefs[0]).toEqual(
      expect.objectContaining({
        table: table('message'),
        column: 'data',
        target: 'file-ref',
        ownerDomain: 'TOPICS',
        kind: 'tolerant'
      })
    )
  })

  it('renamable aggregate supplies cloneAggregate (finalize #16)', () => {
    expect(TOPICS_CONTRIBUTOR.operations?.cloneAggregate).toBeDefined()
  })

  it('cloneAggregate replaces the root PK and rewrites activeNodeId to the cloned message id (§5.3)', async () => {
    const cloneAggregate = TOPICS_CONTRIBUTOR.operations!.cloneAggregate!
    // cloneAggregate is pure (no db on the context). The importer provides
    // memberKeyMap; here we stub the message old→new id mapping.
    const messageMap = new Map<string, string>([['msg-old', 'msg-new']])
    const memberKeyMap = new Map([[table('message'), messageMap]] as const)
    const ctx = {
      aggregate: { root: table('topic') },
      registry: { getPrimaryKey: () => ({ columns: ['id'] }) },
      rootRow: { id: 'topic-old', name: 't', activeNodeId: 'msg-old' },
      newRootKey: 'topic-new',
      memberKeyMap
    } as unknown as CloneAggregateContext
    const result = await cloneAggregate(ctx)
    expect(result.rootRow.id).toBe('topic-new')
    expect(result.rootRow.name).toBe('t') // non-PK fields preserved by the spread
    expect(result.rootRow.activeNodeId).toBe('msg-new') // rewritten to cloned message id
  })

  it('cloneAggregate clears activeNodeId when the referenced message is absent from backup', async () => {
    const cloneAggregate = TOPICS_CONTRIBUTOR.operations!.cloneAggregate!
    const messageMap = new Map<string, string>() // empty: message not cloned
    const memberKeyMap = new Map([[table('message'), messageMap]] as const)
    const ctx = {
      aggregate: { root: table('topic') },
      registry: { getPrimaryKey: () => ({ columns: ['id'] }) },
      rootRow: { id: 'topic-old', activeNodeId: 'msg-gone' },
      newRootKey: 'topic-new',
      memberKeyMap
    } as unknown as CloneAggregateContext
    const result = await cloneAggregate(ctx)
    expect(result.rootRow.activeNodeId).toBeNull() // cleared instead of dangling
  })

  it('primary keys are non-ambiguous (topic uuid-v4; message uuid-v7; chat_message_file_ref uuid-v4)', () => {
    for (const pk of TOPICS_CONTRIBUTOR.schema.primaryKeys) {
      expect(pk.ambiguous).toBeFalsy()
    }
    const topic = TOPICS_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'topic')!
    expect(topic.kind).toBe('uuid-v4')
    const message = TOPICS_CONTRIBUTOR.schema.primaryKeys.find((p) => p.table === 'message')!
    expect(message.kind).toBe('uuid-v7')
  })

  it('schema is deep-frozen (mutation throws)', () => {
    expect(() => {
      ;(TOPICS_CONTRIBUTOR.schema.tables as unknown as string[]).push('x')
    }).toThrow()
  })
})

// DB-backed tests for collectFileResources — returns chat_message_file_ref.fileEntryId (deduped).
describe('TOPICS collectFileResources (collectChatMessageFileIds)', () => {
  const dbh = setupTestDatabase()

  it('returns deduped fileEntryIds (a file attached twice to one message counts once)', async () => {
    // FK chain: topic → message(root, parentId null) → file_entry → chat_message_file_ref.
    await dbh.db.insert(topicTable).values([{ id: 't1', orderKey: 'a' }])
    await dbh.db.insert(messageTable).values([
      { id: 'm1', topicId: 't1', role: 'root', data: {}, status: 'success' },
      { id: 'm2', topicId: 't1', role: 'assistant', parentId: 'm1', data: {}, status: 'success' }
    ])
    await dbh.db.insert(fileEntryTable).values([
      { id: 'cf1', origin: 'internal', name: 'a', size: 10 },
      { id: 'cf2', origin: 'internal', name: 'b', size: 20 }
    ])
    await dbh.db.insert(chatMessageFileRefTable).values([
      { fileEntryId: 'cf1', sourceId: 'm1', role: 'attachment' },
      { fileEntryId: 'cf2', sourceId: 'm1', role: 'attachment' },
      // cf1 also attached to m2 — a different (sourceId) row, but collect dedups by fileEntryId.
      { fileEntryId: 'cf1', sourceId: 'm2', role: 'attachment' }
    ])
    const ids = await collectChatMessageFileIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set(['cf1', 'cf2']))
  })

  it('returns empty set when no chat_message_file_ref rows exist', async () => {
    const ids = await collectChatMessageFileIds(new BackupReadonlyDb(dbh.db))
    expect(ids).toEqual(new Set())
  })
})
