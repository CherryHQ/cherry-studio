import type { JSONValue } from '@ai-sdk/provider'
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
    const rebuilt: JSONValue = codec.assemble(skeleton, { '/0/content': 'TRIMMED' })
    expect(rebuilt).toEqual([{ ...items[0], content: 'TRIMMED' }, items[1]])
    expect(JSON.stringify(rebuilt)).toBe(
      '[{"id":"cite-0","url":"https://a.example","title":"A","content":"TRIMMED"},' +
        '{"id":"cite-1","url":"https://b.example","title":"B","content":"beta body"}]'
    )
  })

  it('declines cyclic metadata so the caller can retain the original output', () => {
    const metadata: Record<string, unknown> = {}
    metadata.self = metadata
    expect(codec.deflate([{ content: 'body', metadata }])).toBeNull()
  })

  it.each([
    ['non-array', { error: 'x' }],
    ['empty array', []],
    ['non-record item', ['plain string']],
    ['missing content field', [{ id: 'a' }]],
    ['non-string content', [{ id: 'a', content: 42 }]],
    ['non-JSON metadata', [{ id: 'a', content: 'body', metadata: { value: 1n } }]]
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

    const rebuilt: JSONValue = codec.assemble(out.skeleton, { '/text': 'TRIMMED' })
    expect(rebuilt).toEqual({ kind: 'text', text: 'TRIMMED', startLine: 1, endLine: 2, totalLines: 2 })
  })

  it('deflate → null for error shapes and non-records', () => {
    expect(codec.deflate({ kind: 'error', code: 'x', message: 'm' })).toBeNull()
    expect(codec.deflate('plain')).toBeNull()
    expect(codec.deflate(null)).toBeNull()
    expect(codec.deflate({ text: 'body', metadata: { callback: () => 'not JSON' } })).toBeNull()
  })
})
