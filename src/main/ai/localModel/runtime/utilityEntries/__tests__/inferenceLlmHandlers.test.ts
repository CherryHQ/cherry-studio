import type { Token, Tokenizer } from 'node-llama-cpp'
import { describe, expect, it } from 'vitest'

// Not exported by the package; these are what LlamaChat runs when a prompt outgrows the context.
import { GeneralChatWrapper } from '../../../../../../../node_modules/node-llama-cpp/dist/chatWrappers/GeneralChatWrapper.js'
import { eraseFirstResponseAndKeepFirstSystemChatContextShiftStrategy } from '../../../../../../../node_modules/node-llama-cpp/dist/evaluator/LlamaChat/utils/contextShiftStrategies/eraseFirstResponseAndKeepFirstSystemChatContextShiftStrategy.js'
import { isContextOverflow } from '../inferenceLlmHandlers'

// One token per character keeps the arithmetic obvious without loading a model.
const tokenizer: Tokenizer = Object.assign((text: string) => Array.from(text, (_, index) => index as Token), {
  detokenize: (tokens: readonly Token[]) => 'x'.repeat(tokens.length),
  isSpecialToken: () => false,
  isEogToken: () => false
})

describe('isContextOverflow', () => {
  it('recognizes the error node-llama-cpp throws for a system prompt too long to compress', async () => {
    const error = await eraseFirstResponseAndKeepFirstSystemChatContextShiftStrategy({
      chatHistory: [
        { type: 'system', text: 'rules '.repeat(2000) },
        { type: 'user', text: 'hello' },
        { type: 'model', response: [] }
      ],
      maxTokensCount: 256,
      tokenizer,
      chatWrapper: new GeneralChatWrapper()
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(isContextOverflow(error)).toBe(true)
  })

  it('leaves other errors alone', () => {
    expect(isContextOverflow(new Error('Model file is corrupted'))).toBe(false)
  })
})
