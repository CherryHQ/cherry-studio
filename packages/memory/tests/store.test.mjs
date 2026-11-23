import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryStore } from '../dist/index.mjs'
import { fixture } from './host.mjs'

test('a rejected final authorization leaves original bytes intact', async () => {
  const { store, files, approve, access } = fixture()
  const { receipt } = await store.read(access, 'MEMORY.md')
  await assert.rejects(
    store.commit(access, [{ kind: 'write', receipt, content: 'old' }], 'controlled', async (proposal) => {
      assert.equal(proposal[0].content, 'old')
      return () => {
        throw Error('revoked')
      }
    }),
    /revoked/
  )
  assert.equal(files.size, 0)
  await store.commit(access, [{ kind: 'write', receipt, content: 'new' }], 'controlled', approve)
  await assert.rejects(
    store.commit(access, [{ kind: 'write', receipt, content: 'old' }], 'controlled', approve),
    /changed/
  )
})

test('a fresh store recovers the committed part of a failed batch', async () => {
  const { store, storage, backup, files, approve, access } = fixture()
  const writes = await Promise.all(
    ['MEMORY.md', '.memories/topic.md'].map(async (path) => ({
      kind: 'write',
      receipt: (await store.read(access, path)).receipt,
      content: path
    }))
  )
  const replace = storage.replace
  storage.replace = async (path, ...args) => {
    if (path.endsWith('topic.md')) throw Error('quota')
    return replace(path, ...args)
  }
  const partial = await store.commit(access, writes, 'controlled', approve)
  assert.deepEqual(
    partial.files.map((f) => f.outcome),
    ['applied', 'unchanged']
  )
  const restarted = new MemoryStore(storage, backup)
  const preview = await restarted.previewRecovery(access)
  await restarted.recover(access, preview.token, approve)
  assert.equal(files.size, 0)
})
test('changing the file set during approval invalidates the exact proposal', async () => {
  const { store, access, files } = fixture()
  const { receipt } = await store.read(access, 'MEMORY.md')
  await assert.rejects(
    store.commit(access, [{ kind: 'write', receipt, content: 'proposal' }], 'controlled', async (changes) => {
      assert.throws(() => {
        changes[0].content = 'other'
      }, TypeError)
      files.set('.memories/new.md', new TextEncoder().encode('outside edit'))
      return () => undefined
    }),
    /changed/
  )
  assert(!files.has('MEMORY.md'))
})
