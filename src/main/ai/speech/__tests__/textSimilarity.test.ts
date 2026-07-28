import { describe, expect, it } from 'vitest'

import { compareSpeechText, tokenizeSpeechText } from '../textSimilarity'

describe('speech text similarity', () => {
  it('normalizes case and punctuation without losing contractions', () => {
    expect(tokenizeSpeechText("Hello, I can't WAIT!")).toEqual(['hello', 'i', "can't", 'wait'])
  })

  it('reports an exact match as fully similar', () => {
    expect(compareSpeechText('Could you help me?', 'could you help me')).toEqual({
      similarity: 1,
      omissions: [],
      additions: []
    })
  })

  it('reports word omissions and additions separately', () => {
    const result = compareSpeechText('I would like a cup of tea', 'I want a tea')

    expect(result.similarity).toBeCloseTo(6 / 11)
    expect(result.omissions).toEqual(['would', 'like', 'cup', 'of'])
    expect(result.additions).toEqual(['want'])
  })
})
