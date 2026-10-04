import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import type { MessageData } from '@shared/data/types/message'

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

describe('setCompactionSummary', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    await dbh.db.insert(topicTable).values({ id: 'topic-c', activeNodeId: 'm1', orderKey: 'a0' })
    await dbh.db.insert(messageTable).values(
      withRoot('topic-c', [
        {
          id: 'm1',
          parentId: null,
          topicId: 'topic-c',
          role: 'user',
          data: mainText('hello'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        }
      ])
    )
  })

  it('sets and reads back the summary on a message row', () => {
    messageService.setCompactionSummary('m1', 'summary of first 10 turns')
    const row = messageService.getById('m1')
    expect(row.compactionSummary).toBe('summary of first 10 turns')
  })

  it('overwrites the summary when called a second time', () => {
    messageService.setCompactionSummary('m1', 'first')
    messageService.setCompactionSummary('m1', 'second')
    const row = messageService.getById('m1')
    expect(row.compactionSummary).toBe('second')
  })

  it('round-trips compactionSummary through getPathToNode (real read path)', () => {
    messageService.setCompactionSummary('m1', 'path-readback')
    const path = messageService.getPathToNode('m1')
    expect(path.at(-1)?.compactionSummary).toBe('path-readback')
  })
})

describe('update — derived compaction context', () => {
  const dbh = setupTestDatabase()

  // root → u1 → a1 → u2 → a2, with a1b branching off u1 beside a1. Every row carries a
  // summary and a context anchor, so each assertion can tell cleared from retained.
  const tree = [
    ['u1', null, 'user'],
    ['a1', 'u1', 'assistant'],
    ['u2', 'a1', 'user'],
    ['a2', 'u2', 'assistant'],
    ['a1b', 'u1', 'assistant']
  ] as const
  const allIds = tree.map(([id]) => id)

  beforeEach(async () => {
    await dbh.db.insert(topicTable).values({ id: 'topic-u', activeNodeId: 'a2', orderKey: 'a0' })
    await dbh.db.insert(messageTable).values(
      withRoot(
        'topic-u',
        tree.map(([id, parentId, role], i) => ({
          id,
          parentId,
          topicId: 'topic-u',
          role,
          data: mainText(`${id} text`),
          status: 'success',
          compactionSummary: `summary through ${id}`,
          stats: { totalTokens: 10, contextTokens: 100 + i },
          createdAt: 100 + i,
          updatedAt: 100 + i
        }))
      )
    )
  })

  const derivedContext = (id: string) => {
    const { compactionSummary, stats } = messageService.getById(id)
    return { compactionSummary, contextTokens: stats?.contextTokens }
  }
  const cleared = { compactionSummary: null, contextTokens: undefined }
  const retained = (id: string) => ({ compactionSummary: `summary through ${id}`, contextTokens: expect.any(Number) })

  it('clears the summary and context anchor on the edited row and every descendant', () => {
    const edited = messageService.update('a1', { data: mainText('a1 text, corrected') })

    for (const id of ['a1', 'u2', 'a2']) expect(derivedContext(id)).toEqual(cleared)
    expect(edited).toMatchObject({ compactionSummary: null, stats: { totalTokens: 10 } })
    expect(edited.stats).not.toHaveProperty('contextTokens')
    // The ancestor and the sibling branch never saw the edited text.
    for (const id of ['u1', 'a1b']) expect(derivedContext(id)).toEqual(retained(id))
  })

  it('keeps summaries and anchors when only data-* parts are added or edited', () => {
    const withTranslation = (content: string): MessageData => ({
      parts: [
        { type: 'text', text: 'a1 text' },
        { type: 'data-translation', data: { content, targetLanguage: 'fr' } }
      ]
    })

    messageService.update('a1', { data: withTranslation('') })
    const updated = messageService.update('a1', { data: withTranslation('bonjour') })

    expect(updated.data.parts).toEqual(withTranslation('bonjour').parts)
    for (const id of allIds) expect(derivedContext(id)).toEqual(retained(id))
  })

  it('does not treat an identical text part with reordered keys as an edit', () => {
    // A live renderer part can differ from the persisted JSON in key order and undefined fields.
    messageService.update('a1', { data: { parts: [{ text: 'a1 text', type: 'text', providerMetadata: undefined }] } })

    for (const id of allIds) expect(derivedContext(id)).toEqual(retained(id))
  })

  it('keeps summaries and anchors on a status-only update', () => {
    const updated = messageService.update('a1', { status: 'paused' })

    expect(updated.status).toBe('paused')
    for (const id of allIds) expect(derivedContext(id)).toEqual(retained(id))
  })
})
