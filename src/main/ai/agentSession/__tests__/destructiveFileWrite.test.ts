import { describe, expect, it } from 'vitest'

import { candidateBytesFor, classifyDestructiveWrite } from '../destructiveFileWrite'

const bytes = (value: string) => new TextEncoder().encode(value)
const classify = (before: string, after: string) =>
  classifyDestructiveWrite({ exists: true, bytes: bytes(before) }, bytes(after))

describe('destructive file writes', () => {
  it('counts deleted UTF-8 bytes even when replacement adds content', () => {
    expect(classify('你好ab', 'abadded')).toBe('large-deletion')
    expect(classify('abcd', 'cd')).toBe('none')
    expect(classify('abcd', 'd')).toBe('large-deletion')
    expect(classify('abc', '')).toBe('empty')
    expect(classify('', '')).toBe('none')
  })

  it('applies edits in order without normalizing line endings', () => {
    const result = candidateBytesFor(
      'MultiEdit',
      {
        edits: [
          { old_string: 'one', new_string: 'two', replace_all: true },
          { old_string: 'two\r\nend', new_string: 'done' }
        ]
      },
      bytes('one\r\none\r\nend')
    )
    expect(new TextDecoder().decode(result)).toBe('two\r\ndone')
    expect(candidateBytesFor('Edit', { old_string: 'x', new_string: '' }, bytes('x x'))).toBeUndefined()
    expect(candidateBytesFor('Edit', { old_string: 'z', new_string: '' }, bytes('x'))).toBeUndefined()
    expect(candidateBytesFor('Write', { content: '' }, bytes('x'))).toEqual(bytes(''))
  })

  it('edits bytes without decoding unrelated binary data', () => {
    expect(classifyDestructiveWrite({ exists: true, bytes: new Uint8Array([0xff]) }, bytes(''))).toBe('empty')
    expect(candidateBytesFor('Edit', { old_string: 'a', new_string: '' }, bytes('a\0'))).toEqual(Buffer.from('\0'))
    expect(classifyDestructiveWrite(undefined, bytes(''))).toBe('undecidable')
  })
})
