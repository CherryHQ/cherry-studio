import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertMemoryTarget,
  memoryEntryPreview,
  memoryModelView,
  parseMemoryEntries,
  serializeMemoryEntries
} from '../dist/index.mjs'

test('ordinary markdown retains its bytes and preview truncates whole UTF-8 lines', () => {
  const text = '界'.repeat(8333) + '\n下一行\n'
  assert.equal(serializeMemoryEntries(parseMemoryEntries(text)), text)
  assert.deepEqual(memoryEntryPreview(text), { content: text.split('\n')[0] + '\n', truncated: true })
  assert.throws(() => assertMemoryTarget('.memories/../private.md'))
  const files = new Map([['MEMORY.md', '']])
  assert.equal(memoryModelView(files, 'MEMORY.md', 'current'), '')
  assert.equal(memoryModelView(files, '.memories/absent.md', 'current'), null)
})
