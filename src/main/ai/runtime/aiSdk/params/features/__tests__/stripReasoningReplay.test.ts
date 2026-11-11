import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import { createStripReasoningReplayMiddleware } from '../stripReasoningReplay'

describe('strip middleware', () => {
  it('removes reasoning parts from assistant messages only', async () => {
    const middleware: LanguageModelMiddleware = createStripReasoningReplayMiddleware()
    const prompt: LanguageModelV3Prompt = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'answer' }
        ]
      }
    ]
    const result = await middleware.transformParams!({
      type: 'stream',
      params: { prompt },
      model: {} as never
    })
    expect(result.prompt[1].content).toEqual([{ type: 'text', text: 'answer' }])
    expect(result.prompt[0]).toEqual(prompt[0])
  })
})
