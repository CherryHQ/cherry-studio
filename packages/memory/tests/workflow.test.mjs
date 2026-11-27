import assert from 'node:assert/strict'
import test from 'node:test'

import { createMemoryEngine, createMemorySearchTurn } from '../dist/index.mjs'
import { engineHost } from './engine-host.mjs'

void test('an admitted batch is saved, organized, recalled, cleared and recovered', async () => {
  let { engine, session, ports, access, approve } = engineHost()
  const read = await session.read('MEMORY.md')
  await session.commit([{ kind: 'write', receipt: read.receipt, content: 'seed' }], async (changes) => {
    assert.equal(changes[0].content, 'seed')
    return () => undefined
  })
  assert.equal((await session.read('MEMORY.md')).content, 'seed')
  const turns = []
  for (let i = 0; i < 8; i++) {
    const user = { id: 'u' + i, version: 'v', role: 'user', createdAt: i + 1, text: i === 7 ? 'I prefer tea' : 'hello' }
    const reply = { ...user, id: 'r' + i, role: 'assistant', text: 'okay' }
    turns.push({ user, reply })
    await session.recordSubmission(user.id, user.version)
    await session.admit(
      { userId: user.id, responseId: reply.id, inputVersion: 'v', responseVersion: 'v', createdAt: user.createdAt },
      new Set(turns.map((t) => t.user.id))
    )
  }
  ports.conversations.window = async () => ({
    turns,
    hash: 'source',
    timeZone: 'UTC',
    validate: async () => {},
    assertCurrent() {}
  })
  const organization = ports.model
  ports.model = async () => ({
    id: 'model',
    countTokens: () => 5,
    contextWindow: 32000,
    generate: async () => ({
      finishReason: 'stop',
      text: JSON.stringify({
        outcome: 'candidates',
        reason: 'preference',
        candidates: [
          {
            text: 'I prefer tea',
            subject: 'user',
            scope: 'personal',
            kind: 'preference',
            conditions: '',
            time: '',
            usefulness: 'choose drinks',
            action: 'add',
            reason: 'user said so',
            existing: [],
            evidence: [{ messageId: 'u7', quote: 'I prefer tea' }]
          }
        ]
      })
    })
  })
  const update = ports.extraction.update.bind(ports.extraction)
  ports.extraction.update = (key, fn) =>
    update(key, (previous) => {
      const hasIntent = Boolean(previous?.intent)
      const result = fn(previous)
      if (hasIntent && !result.state.pending.length) throw Error('interrupted after file commit')
      return result
    })
  await assert.rejects(
    session.runMaintenance({ extraction: true, organization: false }),
    /interrupted after file commit/
  )
  await engine.dispose()
  ports.extraction.update = update
  const resumedAt = Date.now() + 600001
  ports.now = () => resumedAt
  ports.model = async () => {
    throw Error('Committed batch must not call the model again')
  }
  engine = createMemoryEngine(ports)
  session = engine.open(access)
  assert.equal(await session.runMaintenance({ extraction: true, organization: false }), 'recovered')
  assert.equal((await session.entry()).content.match(/I prefer tea/g).length, 1)
  assert.equal(await session.runMaintenance({ extraction: true, organization: false }), 'idle')
  ports.model = organization
  const eligibleAt = ports.now() + 7 * 86400000
  ports.now = () => eligibleAt
  assert.equal(await session.runMaintenance({ extraction: false, organization: true }), 'organized')
  const row = {
    owner: access.owner,
    conversationId: 'chat',
    messageId: 'u7',
    success: true,
    role: 'user',
    createdAt: 8,
    text: 'I prefer tea'
  }
  const recall = createMemorySearchTurn(access, new Set(['next']), {
    version: async () => 'stable',
    candidates: async () => [row],
    selected: async () => ['u7'],
    read: async () => [row],
    protection: async () => ({ revisions: [], deliver: async (_, read) => read() })
  })
  assert.equal((await recall({ query: 'tea' })).items[0].text, 'I prefer tea')
  const clear = await session.previewClear()
  await session.clear(clear.token, approve)
  const fresh = engine.open(access)
  assert.doesNotMatch((await fresh.entry()).content, /Organized/)
  const preview = await fresh.previewRecovery()
  await fresh.recover(preview.token, approve)
  assert.equal((await engine.open(access).entry()).content, 'Organized.')
})
