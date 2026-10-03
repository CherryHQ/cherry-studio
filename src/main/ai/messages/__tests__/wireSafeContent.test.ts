import type { ModelMessage, UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { sanitizeLoneSurrogateContent, toModelMessages } from '../messageRules'

const ui = (role: UIMessage['role'], parts: UIMessage['parts'], id = 'm'): UIMessage => ({ id, role, parts })

/**
 * Independent wire scanner: finds a `\uXXXX` escape in serialized JSON that
 * strict parsers (serde_json) reject — a HIGH surrogate not immediately
 * followed by a LOW escape, or a LOW escape not immediately preceded by one.
 * Backslash parity aware, so literal text `"\\ud800"` (escaped backslash + u)
 * and valid pairs (`"\uD83D\uDE00"`) are not flagged.
 */
function findLoneSurrogateEscape(wire: string): string | null {
  const escapes: Array<{ value: number; raw: string }> = []
  for (let i = 0; i < wire.length; i++) {
    if (wire[i] !== '\\') continue
    let run = 0
    while (wire[i + run] === '\\') run++
    const next = wire.slice(i + run, i + run + 6)
    const m = /^u([0-9a-fA-F]{4})/.exec(next)
    if (m && run % 2 === 1) escapes.push({ value: parseInt(m[1], 16), raw: `\\u${m[1]}` })
    i += run - 1
  }
  for (let k = 0; k < escapes.length; k++) {
    const v = escapes[k].value
    const isHigh = v >= 0xd800 && v <= 0xdbff
    const isLow = v >= 0xdc00 && v <= 0xdfff
    if (isHigh) {
      const following = escapes[k + 1]?.value
      if (following === undefined || following < 0xdc00 || following > 0xdfff) return escapes[k].raw
      k++
    } else if (isLow) {
      return escapes[k].raw
    }
  }
  return null
}

const wireOf = (model: ModelMessage[]): string => JSON.stringify(model)

// Lone HIGH surrogate emits as `\ud800`, failing strict parsers (#20476).
describe('toModelMessages wire safety — lone surrogates (#20476)', () => {
  it('replaces a lone high surrogate in user text so the wire has no lone escape', async () => {
    const model = await toModelMessages([ui('user', [{ type: 'text', text: 'path C:\\new\\\uD800 end' }])])
    const wire = wireOf(model)
    expect(findLoneSurrogateEscape(wire)).toBeNull()
    expect(wire).toContain('\uFFFD')
  })

  it('replaces a lone low surrogate in assistant text', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'hi' }], 'u1'),
      ui('assistant', [{ type: 'text', text: 'result \uDC00 done' }], 'a1')
    ])
    expect(findLoneSurrogateEscape(wireOf(model))).toBeNull()
  })

  it('sanitizes poisoned tool-result text and json outputs', async () => {
    const model = await toModelMessages([
      ui('user', [{ type: 'text', text: 'run it' }], 'u1'),
      ui(
        'assistant',
        [
          {
            type: 'tool-read',
            toolCallId: 'c1',
            state: 'output-available',
            input: { path: 'a\uD800b' },
            output: 'content \uD800 cut'
          }
        ],
        'a1'
      ),
      ui(
        'assistant',
        [
          {
            type: 'tool-json',
            toolCallId: 'c2',
            state: 'output-available',
            input: {},
            output: { snippet: 'x\uDC00y' }
          }
        ],
        'a2'
      )
    ])
    const wire = wireOf(model)
    expect(findLoneSurrogateEscape(wire)).toBeNull()
    expect(wire).toContain('\uFFFD')
  })

  it('leaves valid content byte-identical: emoji pairs, CJK, backslashes, literal \\u text', async () => {
    const texts = [
      'emoji 😀 intact',
      '中文路径 C:\\新建\\文件.txt',
      'regex ^\\d+\\.\\d+$ and hex \\x41',
      'literal six chars \\ud800 stays literal',
      'literal escape \\u0041 stays literal'
    ]
    const model = await toModelMessages([
      ui(
        'user',
        texts.map((text) => ({ type: 'text', text }))
      )
    ])
    expect(findLoneSurrogateEscape(wireOf(model))).toBeNull()
    expect(model).toEqual([{ role: 'user', content: texts.map((text) => ({ type: 'text', text })) }])
  })

  it('preserves references when there is nothing to sanitize', async () => {
    const input = [ui('user', [{ type: 'text', text: 'clean 😀 text' }])]
    const model = await toModelMessages(input)
    // Copy-on-write: no UI-visible reshaping beyond what the pipeline owns.
    expect(wireOf(model)).toBe(JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'clean 😀 text' }] }]))
    expect(findLoneSurrogateEscape(wireOf(model))).toBeNull()
  })
})

describe('sanitizeLoneSurrogateContent copy-on-write', () => {
  it('returns the same references when clean', () => {
    const clean: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'clean 😀' }] },
      { role: 'assistant', content: 'plain' }
    ]
    const out = sanitizeLoneSurrogateContent(clean)
    expect(out).toBe(clean)
    expect(out[0]).toBe(clean[0])
  })

  it('only replaces the poisoned message and part', () => {
    const sibling: ModelMessage = { role: 'user', content: [{ type: 'text', text: 'clean' }] }
    const poisoned: ModelMessage = { role: 'user', content: [{ type: 'text', text: 'a\ud800b' }] }
    const out = sanitizeLoneSurrogateContent([sibling, poisoned])
    expect(out[0]).toBe(sibling)
    expect(out[1]).not.toBe(poisoned)
    expect(out[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'a\uFFFDb' }] })
  })
})

describe('sanitizeLoneSurrogateContent direct coverage', () => {
  it('sanitizes string content', () => {
    const out = sanitizeLoneSurrogateContent([{ role: 'system', content: 'a\ud800b' }])
    expect(out).toEqual([{ role: 'system', content: 'a\uFFFDb' }])
    expect(findLoneSurrogateEscape(JSON.stringify(out))).toBeNull()
  })

  it('sanitizes reasoning parts', () => {
    const out = sanitizeLoneSurrogateContent([
      { role: 'assistant', content: [{ type: 'reasoning', text: 'think \ud800 deep' }] }
    ])
    expect(out).toEqual([{ role: 'assistant', content: [{ type: 'reasoning', text: 'think \uFFFD deep' }] }])
  })

  it('sanitizes tool-call input fields', () => {
    const out = sanitizeLoneSurrogateContent([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: 'a\ud800b' } }]
      }
    ])
    expect(out).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: 'a\uFFFDb' } }]
      }
    ])
  })
})
