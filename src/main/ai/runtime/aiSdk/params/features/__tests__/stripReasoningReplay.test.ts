import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import type { RequestScope } from '../../scope'
import { createStripReasoningReplayMiddleware, stripReasoningReplayFeature } from '../stripReasoningReplay'

const scope = (providerId: string, apiModelId: string, aiSdkProviderId = 'open-responses') =>
  ({
    aiSdkProviderId,
    provider: { id: providerId, presetProviderId: providerId } as Provider,
    model: { id: apiModelId, apiModelId } as Model
  }) as unknown as RequestScope

describe('stripReasoningReplayFeature.applies', () => {
  it('strips for pre-seed-2 Ark models and all HF models, keeps seed-2.x and other providers', () => {
    expect(stripReasoningReplayFeature.applies!(scope('doubao', 'doubao-seed-1.6-250615'))).toBe(true)
    expect(stripReasoningReplayFeature.applies!(scope('huggingface', 'MiniMaxAI/MiniMax-M2'))).toBe(true)
    // seed-2.x accepts reasoning input items (verified live against Ark).
    expect(stripReasoningReplayFeature.applies!(scope('doubao', 'doubao-seed-2-1-pro-260628'))).toBe(false)
    expect(stripReasoningReplayFeature.applies!(scope('deepseek', 'deepseek-v4-flash'))).toBe(false)
    // Only the open-responses family is affected.
    expect(stripReasoningReplayFeature.applies!(scope('doubao', 'doubao-seed-1.6-250615', 'openai-compatible'))).toBe(
      false
    )
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
    expect((result.prompt as LanguageModelV3Prompt)[1].content).toEqual([{ type: 'text', text: 'answer' }])
    expect((result.prompt as LanguageModelV3Prompt)[0]).toEqual(prompt[0])
  })
})
