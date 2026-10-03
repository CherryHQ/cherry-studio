import type { AssistantMessage, Context, Model, Usage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

function createUsage(totalTokens: number): Usage {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

function createAssistant(timestamp: number, totalTokens: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'kept' }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'test-model',
    usage: createUsage(totalTokens),
    stopReason: 'stop',
    timestamp
  }
}

const model: Model<'openai-responses'> = {
  id: 'test-model',
  name: 'Test Model',
  api: 'openai-responses',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 8_000
}

async function outputBudget(context: Context) {
  const { buildBaseOptions } = await import('@earendil-works/pi-ai/api/simple-options')
  return buildBaseOptions(model, context).maxTokens
}

describe('pi-ai compaction output budget', () => {
  it('ignores assistant usage older than an inserted compaction summary', async () => {
    const context: Context = {
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: 'summary', timestamp: 200 },
        createAssistant(100, 9_500),
        { role: 'user', content: 'x'.repeat(4_000), timestamp: 300 }
      ]
    }

    expect(await outputBudget(context)).toBe(4_899)
  })

  it('uses assistant usage again after a post-compaction response', async () => {
    const context: Context = {
      messages: [
        { role: 'user', content: 'summary', timestamp: 200 },
        createAssistant(100, 9_500),
        { role: 'user', content: 'new prompt', timestamp: 300 },
        createAssistant(400, 2_000),
        { role: 'user', content: 'tail', timestamp: 500 }
      ]
    }

    expect(await outputBudget(context)).toBe(3_903)
  })
})
