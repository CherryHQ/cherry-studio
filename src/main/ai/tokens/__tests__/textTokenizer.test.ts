import { describe, expect, it } from 'vitest'

import { loadGptO200kTokenizer } from '../textTokenizer'

describe('loadGptO200kTokenizer', () => {
  it.each(['<|im_start|>', '<|im_end|>', '<|endoftext|>', '<|endofturn|>', '<|endofmessage|>'])(
    'counts the literal special-token text %s without rejecting the message',
    async (literal) => {
      const tokenizer = await loadGptO200kTokenizer()
      const literalTokenCount = tokenizer.count(literal)

      expect(literalTokenCount).toBeGreaterThan(1)
      expect(tokenizer.count(`Before ${literal} after`)).toBeGreaterThan(literalTokenCount)
    }
  )
})
