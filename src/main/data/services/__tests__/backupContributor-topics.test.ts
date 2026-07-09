// Unit tests for the TOPICS contributor — pure declaration assertions (no DB).
import type { CloneAggregateContext } from '@main/data/db/backup/contributor-types'
import { table } from '@main/data/db/backup/dbSchemaRefs'
import { describe, expect, it } from 'vitest'

import { TOPICS_CONTRIBUTOR } from '../backupContributor-topics'

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
