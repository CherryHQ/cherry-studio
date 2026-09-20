import { describe, expect, it } from 'vitest'

import { createLineDecoder } from '../host/stdioRelay'

function collect(cap?: number) {
  const lines: Array<[string, boolean]> = []
  const decoder = createLineDecoder((line, truncated) => lines.push([line, truncated]), cap)
  return { lines, decoder }
}

describe('createLineDecoder', () => {
  it('joins a line split across chunks and strips CRLF', () => {
    const { lines, decoder } = collect()
    decoder.push('hel')
    decoder.push('lo\r\nwor')
    decoder.push('ld\n')
    expect(lines).toEqual([
      ['hello', false],
      ['world', false]
    ])
  })

  it('decodes a multi-byte UTF-8 character split across chunk boundaries', () => {
    const { lines, decoder } = collect()
    const bytes = Buffer.from('模型\n', 'utf8')
    decoder.push(bytes.subarray(0, 2))
    decoder.push(bytes.subarray(2))
    expect(lines).toEqual([['模型', false]])
  })

  it('flushes a trailing partial line on end', () => {
    const { lines, decoder } = collect()
    decoder.push('tail')
    expect(lines).toEqual([])
    decoder.end()
    expect(lines).toEqual([['tail', false]])
  })

  it('truncates an over-cap line, discards its remainder, and resumes on the next line', () => {
    const { lines, decoder } = collect(4)
    decoder.push('abcdef')
    decoder.push('ghij\nok\n')
    expect(lines).toEqual([
      ['abcd', true],
      ['ok', false]
    ])
  })

  it('truncates an over-cap line that arrives complete in one chunk', () => {
    const { lines, decoder } = collect(4)
    decoder.push('abcdefgh\n')
    expect(lines).toEqual([['abcd', true]])
  })
})
