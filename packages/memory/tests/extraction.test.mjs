import assert from 'node:assert/strict'
import test from 'node:test'

import { ExtractionQueue, extractAndSave } from '../dist/index.mjs'
import { fixture } from './host.mjs'

export const model = {
  id: 'fixture',
  countTokens: () => 32,
  contextWindow: 16000,
  async generate() {
    return {
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
            usefulness: 'drink recommendation',
            action: 'add',
            reason: 'explicit',
            evidence: [{ messageId: 'u', quote: 'I prefer tea' }],
            existing: []
          }
        ]
      })
    }
  }
}
test('user quotes must belong to the authorized snapshot', async () => {
  const { store, access, approve } = fixture()
  const message = { id: 'u', version: '1', role: 'user', createdAt: 0, text: 'I prefer tea' }
  const window = { hash: 'v', timeZone: 'UTC', conversationId: 'c', kind: 'chat', messages: [message] }
  const run = () => extractAndSave(store, access, window, model, new AbortController().signal, async () => {}, approve)
  await run()
  assert.match((await store.read(access, 'MEMORY.md')).content, /I prefer tea/)
  message.text = 'Something else'
  await assert.rejects(run, /output/)
})
test('ordinary restart resumes registered turns at local 21:00', async () => {
  let saved,
    at = new Date(2025, 0, 1, 20, 59).getTime()
  const states = {
    async update(key, fn) {
      const r = fn(saved ? JSON.parse(saved) : undefined)
      saved = JSON.stringify(r.state)
      return r.value
    }
  }
  const q = new ExtractionQueue(states, () => at)
  await q.recordSubmission('c', 'u', 'v')
  await q.admit(
    'c',
    { userId: 'u', responseId: 'r', createdAt: at, inputVersion: 'v', responseVersion: 'v' },
    new Set(['u'])
  )
  assert.equal(await q.due('c'), undefined)
  at += 60000
  const restarted = new ExtractionQueue(states, () => at)
  const due = await restarted.due('c')
  assert.equal(due.end, 'u')
  await restarted.finish('c', due.generation, due.end)
  assert.equal(await restarted.due('c'), undefined)
})
for (const reason of ['changed', 'corrected', 'qualified'])
  test('correction preserves history and hides duplicates: ' + reason, async () => {
    const { store, access, approve } = fixture()
    for (const path of ['MEMORY.md', '.memories/topic.md']) {
      const { receipt } = await store.read(access, path)
      await store.commit(access, [{ kind: 'write', receipt, content: '- tea\n' }], 'controlled', approve)
    }
    const source = {
      kind: 'chat',
      conversationId: 'c',
      hash: 'v',
      timeZone: 'America/Los_Angeles',
      messages: [{ id: 'u', version: '1', role: 'user', createdAt: Date.UTC(2025, 0, 2), text: 'I prefer water today' }]
    }
    const corrected = {
      ...model,
      async generate() {
        const { text } = await model.generate()
        const output = JSON.parse(text)
        Object.assign(output.candidates[0], {
          action: 'correct',
          correction: reason,
          time: 'today',
          text: 'I prefer water today',
          evidence: [{ messageId: 'u', quote: 'I prefer water today' }],
          existing: [{ path: 'MEMORY.md', quote: 'tea' }]
        })
        return { finishReason: 'stop', text: JSON.stringify(output) }
      }
    }
    const { result } = await extractAndSave(
      store,
      access,
      source,
      corrected,
      new AbortController().signal,
      async () => {},
      approve
    )
    assert.equal(result.files[0].outcome, 'applied')
    assert.doesNotMatch((await store.modelRead(access, '.memories/topic.md')).content, /tea/)
    const [revision] = await store.revisions(access)
    assert.equal(revision.retirement.reason, reason)
    assert.match(revision.retirement.replacement, /2025-01-01/)
    assert.equal(revision.retirement.sources[0].sourceVersion, '1')
  })
