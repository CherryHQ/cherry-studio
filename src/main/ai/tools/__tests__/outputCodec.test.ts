import { CITATION_SNIPPET_MAX_CHARS } from '@shared/ai/builtinTools'
import { describe, expect, it } from 'vitest'

import { makeEntitiesCodec, makeTextFieldCodec } from '../outputCodec'

describe('makeEntitiesCodec', () => {
  const codec = makeEntitiesCodec({ contentKey: 'content' })
  const items = [
    { id: 'cite-0', url: 'https://a.example', title: 'A', content: 'alpha body' },
    { id: 'cite-1', url: 'https://b.example', title: 'B', content: 'beta body' }
  ]

  it('deflates one blob per entity keyed by JSON-pointer-lite path', () => {
    const out = codec.deflate(items)!
    expect(out.blobs).toEqual([
      { key: '/0/content', text: 'alpha body' },
      { key: '/1/content', text: 'beta body' }
    ])
    expect(out.skeleton).toBe(items)
  })

  it('assemble with unchanged texts is an identity (same item references)', () => {
    const { skeleton, blobs } = codec.deflate(items)!
    const texts = Object.fromEntries(blobs.map((b) => [b.key, b.text]))
    const rebuilt = codec.assemble(skeleton, texts) as unknown[]
    expect(rebuilt[0]).toBe(items[0])
    expect(rebuilt[1]).toBe(items[1])
  })

  it('assemble preserves key insertion order when swapping content (byte-stable stringify)', () => {
    const { skeleton } = codec.deflate(items)!
    const rebuilt = codec.assemble(skeleton, { '/0/content': 'TRIMMED' }) as Array<Record<string, unknown>>
    expect(Object.keys(rebuilt[0])).toEqual(['id', 'url', 'title', 'content'])
    expect(rebuilt[0].content).toBe('TRIMMED')
    expect(rebuilt[0].id).toBe('cite-0')
    expect(rebuilt[1]).toBe(items[1])
  })

  it.each([
    ['non-array', { error: 'x' }],
    ['empty array', []],
    ['non-record item', ['plain string']],
    ['missing content field', [{ id: 'a' }]],
    ['non-string content', [{ id: 'a', content: 42 }]]
  ])('deflate → null for %s', (_label, value) => {
    expect(codec.deflate(value)).toBeNull()
  })

  it('snippet uses the shared citation preview cap', () => {
    expect(codec.snippet('  short  ')).toBe('short')
    const long = 'y'.repeat(CITATION_SNIPPET_MAX_CHARS + 200)
    const s = codec.snippet(long)
    expect(s).toHaveLength(CITATION_SNIPPET_MAX_CHARS + 1)
    expect(s.endsWith('…')).toBe(true)
  })
})

describe('makeTextFieldCodec', () => {
  const codec = makeTextFieldCodec({ textKey: 'text' })

  it('deflates the single text field and reassembles around it', () => {
    const output = { kind: 'text', text: 'body', startLine: 1, endLine: 2, totalLines: 2 }
    const out = codec.deflate(output)!
    expect(out.blobs).toEqual([{ key: '/text', text: 'body' }])

    const rebuilt = codec.assemble(out.skeleton, { '/text': 'TRIMMED' }) as Record<string, unknown>
    expect(Object.keys(rebuilt)).toEqual(['kind', 'text', 'startLine', 'endLine', 'totalLines'])
    expect(rebuilt.text).toBe('TRIMMED')
    expect(rebuilt.kind).toBe('text')
  })

  it('deflate → null for error shapes and non-records', () => {
    expect(codec.deflate({ kind: 'error', code: 'x', message: 'm' })).toBeNull()
    expect(codec.deflate('plain')).toBeNull()
    expect(codec.deflate(null)).toBeNull()
  })

  it('assemble with unchanged text is an identity (same reference)', () => {
    const output = { kind: 'text', text: 'body' }
    const { skeleton, blobs } = codec.deflate(output)!
    expect(codec.assemble(skeleton, { '/text': blobs[0].text })).toBe(output)
  })
})
