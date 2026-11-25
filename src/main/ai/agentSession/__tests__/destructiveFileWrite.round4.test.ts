import diff from 'fast-diff'
import { expect, it, vi } from 'vitest'

vi.mock('fast-diff', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof diff }>()
  return { default: Object.assign(vi.fn(original.default), original.default) }
})

import { candidateBytesFor, classifyDestructiveWrite } from '../destructiveFileWrite'

it('preserves Pi line endings and applies edits against the original', () => {
  const result = candidateBytesFor(
    'edit',
    {
      edits: [
        { oldText: 'one\ntwo', newText: 'ONE\nTWO' },
        { oldText: 'four', newText: 'FOUR' }
      ]
    },
    Buffer.from('one\r\ntwo\r\nthree\r\nfour\r\n')
  )
  expect(result).toEqual(Buffer.from('ONE\r\nTWO\r\nthree\r\nFOUR\r\n'))
})

it('bounds work for large replacements', () => {
  vi.mocked(diff).mockClear()
  expect(
    classifyDestructiveWrite({ exists: true, bytes: Buffer.from('a'.repeat(32000)) }, Buffer.from('b'.repeat(32000)))
  ).toBe('undecidable')
  expect(diff).not.toHaveBeenCalled()
})

it.each([
  ['one\ntwo\r\nthree\r\n', 'one\nTWO\nMORE\nthree\n'],
  ['one\r\ntwo\nthree\n', 'one\r\nTWO\r\nMORE\r\nthree\r\n'],
  ['\uFEFFone\ntwo\r\nthree\r\n', '\uFEFFone\nTWO\nMORE\nthree\n']
])('matches durable line endings and BOM', (before, after) => {
  expect(
    candidateBytesFor('edit', { edits: [{ oldText: 'two', newText: 'TWO\nMORE' }] }, Buffer.from(before), 'pi-durable')
  ).toEqual(Buffer.from(after))
})
