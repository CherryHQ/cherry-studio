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
    expect(out.skeleton).toEqual(items)
  })

  it('assemble replaces content while preserving entity metadata', () => {
    const { skeleton } = codec.deflate(items)!
    const rebuilt = codec.assemble(skeleton, { '/0/content': 'TRIMMED' }) as Array<Record<string, unknown>>
    expect(rebuilt[0].content).toBe('TRIMMED')
    expect(rebuilt[0].id).toBe('cite-0')
    expect(rebuilt[1]).toEqual(items[1])
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
})

describe('makeTextFieldCodec', () => {
  const codec = makeTextFieldCodec({ textKey: 'text' })

  it('deflates the single text field and reassembles around it', () => {
    const output = { kind: 'text', text: 'body', startLine: 1, endLine: 2, totalLines: 2 }
    const out = codec.deflate(output)!
    expect(out.blobs).toEqual([{ key: '/text', text: 'body' }])

    const rebuilt = codec.assemble(out.skeleton, { '/text': 'TRIMMED' }) as Record<string, unknown>
    expect(rebuilt.text).toBe('TRIMMED')
    expect(rebuilt.kind).toBe('text')
  })

  it('deflate → null for error shapes and non-records', () => {
    expect(codec.deflate({ kind: 'error', code: 'x', message: 'm' })).toBeNull()
    expect(codec.deflate('plain')).toBeNull()
    expect(codec.deflate(null)).toBeNull()
  })
})
