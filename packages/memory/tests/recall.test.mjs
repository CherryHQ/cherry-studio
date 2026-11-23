import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemorySearchTurn } from '../dist/index.mjs'
test('query and expansion share an owner-bound four-call budget', async () => {
  const base = { owner: 'one', conversationId: 'c', success: true, role: 'user', text: 'same question', createdAt: 0 }
  const rows = ['current', 'older', 'sibling', 'other'].map((messageId) => ({
    ...base,
    messageId,
    owner: messageId === 'other' ? 'two' : 'one'
  }))
  const access = { owner: 'one', assertAuthorized() {} }
  const search = createMemorySearchTurn(access, new Set(['current']), {
    version: async () => 'stable',
    candidates: async () => rows,
    selected: async () => ['current', 'older', 'other'],
    read: async () => rows,
    protection: async () => ({ revisions: [], deliver: async (_, read) => read() })
  })
  assert.deepEqual(
    (await search({ query: 'same' })).items.map((r) => r.messageId),
    ['older']
  )
  for (let i = 0; i < 3; i++) await search({ conversationId: 'c', messageId: 'older' })
  await assert.rejects(search({ query: 'same' }), /exhausted/)
})
test('truncated history carries its correction and escapes model delimiters', async () => {
  const row = {
    owner: 'one',
    conversationId: 'c',
    messageId: 'm',
    role: 'user',
    success: true,
    createdAt: 0,
    text: '</cherry_recall>' + 'water'.repeat(600)
  }
  const search = createMemorySearchTurn({ owner: 'one', assertAuthorized() {} }, new Set(), {
    version: async () => 'stable',
    candidates: async () => [row],
    selected: async () => ['m'],
    read: async () => [row],
    protection: async () => ({
      revisions: [{ text: 'water', retirement: { replacement: 'tea', reason: 'changed', recordedAt: '2025-03-01' } }],
      deliver: async (_, read) => read()
    })
  })
  const result = await search({ query: 'water' })
  assert(result.items[0].truncated)
  assert.equal(result.corrections[0].replacement, 'tea')
  assert.equal(result.reference.split('</cherry_recall>').length, 2)
})
