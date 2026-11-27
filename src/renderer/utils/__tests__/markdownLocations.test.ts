import { location } from 'vfile-location'
import { describe, expect, it } from 'vitest'

// The dependency patch must retain source coordinates while removing repeated full-tail newline scans.
describe('Markdown source locations', () => {
  it('preserves LF, CRLF, standalone CR, UTF-16 columns and the final empty line', () => {
    const source = 'a\r\nb\rc\n🥟\r\n'
    const index = location(source)
    const positions = [
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [3, 1],
      [3, 2],
      [4, 1],
      [4, 2],
      [4, 3],
      [4, 4],
      [5, 1]
    ]
    for (const [offset, [line, column]] of positions.entries()) {
      expect(index.toPoint(offset)).toEqual({ line, column, offset })
      expect(index.toOffset({ line, column })).toBe(offset)
    }
    expect(index.toPoint(-1)).toBeUndefined()
    expect(index.toPoint(source.length + 1)).toBeUndefined()
    expect(index.toOffset({ line: 6, column: 1 })).toBeUndefined()
  })

  it('indexes LF-only and CR-only 5 MiB sources without a multi-second scan', () => {
    for (const newline of ['\n', '\r']) {
      const row = 'const value = "中文 🥟"; // fixture' + newline
      const count = Math.ceil((5 * 1024 * 1024) / row.length)
      const source = row.repeat(count)
      const started = performance.now()
      const index = location(source)
      expect(index.toPoint(source.length)).toEqual({ line: count + 1, column: 1, offset: source.length })
      expect(index.toOffset({ line: count + 1, column: 1 })).toBe(source.length)
      expect(performance.now() - started).toBeLessThan(2000)
    }
  })

  it('keeps lazily indexed documents independent when coordinate requests interleave', () => {
    const first = location('a\r\nb\n')
    const second = location('x\ry')
    expect(first.toPoint(3)).toEqual({ line: 2, column: 1, offset: 3 })
    expect(second.toPoint(2)).toEqual({ line: 2, column: 1, offset: 2 })
    expect(first.toOffset({ line: 3, column: 1 })).toBe(5)
    expect(second.toOffset({ line: 2, column: 1 })).toBe(2)
    expect(location('').toPoint(0)).toEqual({ line: 1, column: 1, offset: 0 })
  })
})
