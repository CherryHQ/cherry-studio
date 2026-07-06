import { describe, expect, it } from 'vitest'

import type { ChunkedKnowledgeContent } from '../chunk'
import { refineChunksByTokenLimit } from '../tokenLimit'

const countChars = (text: string) => text.length

function expectVerbatimSlices(chunked: ChunkedKnowledgeContent) {
  for (const chunk of chunked.chunks) {
    expect(chunked.contentText.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
  }
}

describe('refineChunksByTokenLimit', () => {
  it('keeps chunks that are already within the token limit', () => {
    const chunked: ChunkedKnowledgeContent = {
      contentText: 'alpha\n\nbeta',
      chunks: [
        { unitIndex: 4, charStart: 0, charEnd: 5, text: 'alpha' },
        { unitIndex: 9, charStart: 7, charEnd: 11, text: 'beta' }
      ]
    }

    const refined = refineChunksByTokenLimit(chunked, {
      maxTokens: 5,
      overlapTokens: 1,
      countTokens: countChars
    })

    expect(refined.contentText).toBe(chunked.contentText)
    expect(refined.chunks).toEqual([
      { unitIndex: 0, charStart: 0, charEnd: 5, text: 'alpha' },
      { unitIndex: 1, charStart: 7, charEnd: 11, text: 'beta' }
    ])
    expectVerbatimSlices(refined)
  })

  it('splits oversized chunks and keeps every emitted chunk under the token limit', () => {
    const chunked: ChunkedKnowledgeContent = {
      contentText: 'abcdefghij',
      chunks: [{ unitIndex: 0, charStart: 0, charEnd: 10, text: 'abcdefghij' }]
    }

    const refined = refineChunksByTokenLimit(chunked, {
      maxTokens: 4,
      overlapTokens: 1,
      countTokens: countChars
    })

    expect(refined.chunks.length).toBeGreaterThan(1)
    expect(refined.chunks.map((chunk) => chunk.unitIndex)).toEqual(refined.chunks.map((_, index) => index))
    for (const chunk of refined.chunks) {
      expect(countChars(chunk.text)).toBeLessThanOrEqual(4)
    }
    for (let index = 1; index < refined.chunks.length; index += 1) {
      const previous = refined.chunks[index - 1]
      const current = refined.chunks[index]
      expect(previous.charEnd - current.charStart).toBeLessThanOrEqual(1)
      expect(current.charStart).toBeGreaterThan(previous.charStart)
    }
    expectVerbatimSlices(refined)
  })

  it('prefers natural boundaries before hard token cuts', () => {
    const chunked: ChunkedKnowledgeContent = {
      contentText: 'alpha beta gamma',
      chunks: [{ unitIndex: 0, charStart: 0, charEnd: 16, text: 'alpha beta gamma' }]
    }

    const refined = refineChunksByTokenLimit(chunked, {
      maxTokens: 10,
      overlapTokens: 0,
      countTokens: countChars
    })

    expect(refined.chunks[0]).toEqual({ unitIndex: 0, charStart: 0, charEnd: 10, text: 'alpha beta' })
    expectVerbatimSlices(refined)
  })

  it('clamps overlap and still makes progress', () => {
    const chunked: ChunkedKnowledgeContent = {
      contentText: 'abcdefghijkl',
      chunks: [{ unitIndex: 0, charStart: 0, charEnd: 12, text: 'abcdefghijkl' }]
    }

    const refined = refineChunksByTokenLimit(chunked, {
      maxTokens: 4,
      overlapTokens: 99,
      countTokens: countChars
    })

    expect(refined.chunks.length).toBeGreaterThan(1)
    for (let index = 1; index < refined.chunks.length; index += 1) {
      expect(refined.chunks[index].charStart).toBeGreaterThan(refined.chunks[index - 1].charStart)
    }
    expect(refined.chunks.at(-1)?.charEnd).toBe(12)
    expectVerbatimSlices(refined)
  })
})
