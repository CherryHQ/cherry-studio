import assert from 'node:assert/strict'
import test from 'node:test'

import { engineHost } from './engine-host.mjs'
test('manual organization uses the validated proposal and leaves the first conversation snapshot stable', async () => {
  const { session, approve } = engineHost()
  const read = await session.read('MEMORY.md')
  await session.commit([{ kind: 'write', receipt: read.receipt, content: 'Original.' }], approve)
  assert.equal((await session.context()).content, 'Original.')
  await session.requestOrganization()
  assert.equal(await session.runMaintenance({ extraction: false, organization: true }), 'organized')
  assert.equal((await session.read('MEMORY.md')).content, 'Organized.')
  assert.equal((await session.context()).content, 'Original.')
})
test('interrupting a model call discards its output and preserves a manual request', async () => {
  const { session, ports, engine, approve } = engineHost()
  const { receipt } = await session.read('MEMORY.md')
  await session.commit([{ kind: 'write', receipt, content: 'before' }], approve)
  await session.requestOrganization()
  const normal = ports.model
  let started, release
  const ready = new Promise((r) => {
    started = r
  })
  ports.model = async () => ({
    ...(await normal()),
    generate: async () => {
      started()
      await new Promise((r) => {
        release = r
      })
      return { finishReason: 'stop', text: '{}' }
    }
  })
  const running = session.runMaintenance({ extraction: false, organization: true })
  await ready
  engine.interrupt()
  release()
  await assert.rejects(running)
  assert.equal((await session.read('MEMORY.md')).content, 'before')
  ports.model = normal
  assert.equal(await session.runMaintenance({ extraction: false, organization: true }), 'organized')
})
test('ten controlled changes or seven days make pending organization eligible', async () => {
  for (const mode of ['count', 'age']) {
    const { session, ports, approve } = engineHost()
    let at = Date.UTC(2025, 0, 1)
    ports.now = () => at
    const options = { organization: true, extraction: false }
    for (let i = 0; i < (mode === 'count' ? 10 : 1); i++) {
      const { receipt } = await session.read('MEMORY.md')
      await session.commit([{ kind: 'write', receipt, content: 'change ' + i }], approve)
      if (i < 9) assert.equal(await session.runMaintenance(options), 'idle')
    }
    if (mode === 'age') at += 7 * 86400000
    assert.equal(await session.runMaintenance({ ...options, organization: false }), 'idle')
    assert.equal(await session.runMaintenance(options), 'organized')
  }
})
test('clearing another conversation invalidates persisted admissions across restart', async () => {
  const { session, ports, engine, access, approve } = engineHost()
  const other = engine.open({ ...access, conversationId: 'other' })
  await other.recordSubmission('u', 'v')
  const { receipt } = await session.read('MEMORY.md')
  await session.commit([{ kind: 'write', receipt, content: 'before clear' }], approve)
  await session.clear((await session.previewClear()).token, approve)
  const { createMemoryEngine } = await import('../dist/index.mjs')
  const reopened = createMemoryEngine(ports).open({ ...access, conversationId: 'other' })
  assert.equal(
    await reopened.admit(
      { userId: 'u', responseId: 'r', inputVersion: 'v', responseVersion: 'v', createdAt: 1 },
      new Set(['u'])
    ),
    false
  )
})
