import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { RequestScope } from '../../scope'
import { createStripReasoningReplayMiddleware, stripReasoningReplayFeature } from '../stripReasoningReplay'

const scope = (providerId: string, apiModelId: string, aiSdkProviderId = 'open-responses') =>
  ({
    aiSdkProviderId,
    provider: { id: providerId, presetProviderId: providerId } as Provider,
    model: { id: apiModelId, apiModelId } as Model
  }) as unknown as RequestScope

describe('stripReasoningReplayFeature.applies', () => {
  it('strips only for the HuggingFace router on the neutral adapter', () => {
    expect(stripReasoningReplayFeature.applies!(scope('huggingface', 'MiniMaxAI/MiniMax-M2'))).toBe(true)
    // Faithful Responses endpoints keep their reasoning replay.
    expect(stripReasoningReplayFeature.applies!(scope('deepseek', 'deepseek-v4-flash', 'openai'))).toBe(false)
    expect(stripReasoningReplayFeature.applies!(scope('doubao', 'doubao-seed-2-1-pro-260628', 'openai'))).toBe(false)
    expect(stripReasoningReplayFeature.applies!(scope('huggingface', 'MiniMaxAI/MiniMax-M2', 'openai'))).toBe(false)
  })
})

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
      params: { prompt } as never,
      model: {} as never
    })
    expect(result.prompt[1].content).toEqual([{ type: 'text', text: 'answer' }])
    expect(result.prompt[0]).toEqual(prompt[0])
  })
})
