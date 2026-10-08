import { isStepCount, tool, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createAgent } from '../createAgent'

describe('createAgent provider boundary', () => {
  it('preserves scoped tool execution, middleware, media and aggregate usage through a V4 provider', async () => {
    const requests: Array<Record<string, any>> = []
    const effects: string[] = []
    const lookup = tool({
      inputSchema: z.object({ limit: z.number().default(2) }),
      contextSchema: z.object({ scope: z.string() }),
      execute: async ({ limit }, { context }) => {
        effects.push(`${context.scope}:${limit}`)
        return { scope: context.scope, limit }
      }
    })
    const agent = await createAgent({
      providerId: 'openai-chat',
      providerSettings: {
        apiKey: 'test-key',
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)))
          const first = requests.length === 1
          return Response.json({
            id: `response-${requests.length}`,
            model: 'gpt-4o',
            created: 0,
            choices: [
              {
                index: 0,
                finish_reason: first ? 'tool_calls' : 'stop',
                message: first
                  ? {
                      role: 'assistant',
                      content: 'Looking up.',
                      tool_calls: [{ id: 'lookup-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }]
                    }
                  : { role: 'assistant', content: 'The answer is scoped.' }
              }
            ],
            usage: { prompt_tokens: first ? 10 : 20, completion_tokens: first ? 3 : 5, total_tokens: first ? 13 : 25 }
          })
        }
      },
      modelId: 'gpt-4o',
      wrapModel: (model) =>
        wrapLanguageModel({
          model,
          middleware: {
            specificationVersion: 'v4',
            transformParams: async ({ params }) => ({ ...params, temperature: 0.25 })
          }
        }),
      agentSettings: {
        instructions: 'Keep the request scope.',
        tools: { lookup },
        toolsContext: { lookup: { scope: 'workspace-a' } },
        stopWhen: isStepCount(3)
      }
    })
    const result = await agent.generate({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look up this image.' },
            { type: 'file', mediaType: 'image/png', data: new URL('https://images.example/input.png') }
          ]
        }
      ]
    })

    expect(effects).toEqual(['workspace-a:2'])
    expect(result.finalStep.text).toBe('The answer is scoped.')
    expect(result.usage).toMatchObject({ inputTokens: 30, outputTokens: 8, totalTokens: 38 })
    expect(result.steps).toHaveLength(2)
    expect(requests.map((request) => request.temperature)).toEqual([0.25, 0.25])
    expect(requests[0].messages).toEqual([
      { role: 'system', content: 'Keep the request scope.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look up this image.' },
          { type: 'image_url', image_url: { url: 'https://images.example/input.png' } }
        ]
      }
    ])
    expect(requests[1].messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'lookup-1',
      content: JSON.stringify({ scope: 'workspace-a', limit: 2 })
    })
  })
})

describe('xAI endpoint selection', () => {
  it.each(['xai', 'xai-responses'] as const)(
    'preserves the selected %s endpoint with a V4 model',
    async (providerId) => {
      let requestUrl: string | undefined
      let requestBody: Record<string, any> | undefined
      const agent = await createAgent({
        providerId,
        agentSettings: {},
        modelId: 'grok-4',
        providerSettings: {
          apiKey: 'test',
          baseURL: 'https://xai.test/v1',
          fetch: async (url, init) => {
            requestUrl = String(url)
            requestBody = JSON.parse(String(init?.body))
            return Response.json(
              providerId === 'xai'
                ? {
                    id: 'chat-1',
                    created: 0,
                    model: 'grok-4',
                    choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }]
                  }
                : {
                    id: 'resp-1',
                    object: 'response',
                    created_at: 0,
                    model: 'grok-4',
                    status: 'completed',
                    output: [
                      {
                        type: 'message',
                        id: 'msg-1',
                        role: 'assistant',
                        status: 'completed',
                        content: [{ type: 'output_text', text: 'Hello', annotations: [] }]
                      }
                    ]
                  }
            )
          }
        }
      })
      const result = await agent.generate({ prompt: 'Hello' })
      expect(result.finalStep.text).toBe('Hello')
      expect(requestUrl).toBe(`https://xai.test/v1/${providerId === 'xai' ? 'chat/completions' : 'responses'}`)
      expect(requestBody).toHaveProperty(providerId === 'xai' ? 'messages' : 'input')
    }
  )
})
