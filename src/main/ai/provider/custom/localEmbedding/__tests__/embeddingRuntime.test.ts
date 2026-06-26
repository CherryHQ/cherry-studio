import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Fake transformers.js Tensor of shape [1, tokens.length, hidden]. */
function makeTensor(tokens: number[][]) {
  return {
    dims: [1, tokens.length, tokens[0].length],
    tolist: () => [tokens]
  }
}

const extractorMock = vi.fn()

// Replace transformers.js so tests never load the model / native runtime.
vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: vi.fn(async () => extractorMock)
}))

import { embedTexts } from '../embeddingRuntime'

describe('embedTexts — Qwen3 last-token pooling', () => {
  beforeEach(() => {
    extractorMock.mockReset()
  })

  it('returns the L2-normalized last-token vector and requests pooling:none', async () => {
    // 3 tokens, hidden=2; last token [3,4] → normalized [0.6, 0.8].
    extractorMock.mockResolvedValue(
      makeTensor([
        [1, 0],
        [0, 1],
        [3, 4]
      ])
    )

    const [vector] = await embedTexts(['hello'])

    expect(vector[0]).toBeCloseTo(0.6, 6)
    expect(vector[1]).toBeCloseTo(0.8, 6)
    expect(Math.hypot(...vector)).toBeCloseTo(1, 6)
    expect(extractorMock).toHaveBeenCalledWith('hello', { pooling: 'none', normalize: false })
  })

  it('embeds each text independently and short-circuits empty input', async () => {
    expect(await embedTexts([])).toEqual([])
    expect(extractorMock).not.toHaveBeenCalled()

    extractorMock.mockImplementation(async (text: string) => makeTensor([[1, 1], text === 'a' ? [2, 0] : [0, 2]]))

    const vectors = await embedTexts(['a', 'b'])

    expect(vectors).toHaveLength(2)
    expect(vectors[0]).toEqual([1, 0]) // last token [2,0] → unit x
    expect(vectors[1]).toEqual([0, 1]) // last token [0,2] → unit y
  })

  it('throws without embedding when the signal is already aborted', async () => {
    extractorMock.mockResolvedValue(makeTensor([[1, 0]]))
    const controller = new AbortController()
    controller.abort()

    await expect(embedTexts(['x'], controller.signal)).rejects.toBeDefined()
    expect(extractorMock).not.toHaveBeenCalled()
  })
})
