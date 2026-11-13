import { simulateStreamingMiddleware, type UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import type { AiPlugin } from '@cherrystudio/ai-core'

import { Agent } from '../../Agent'
import type { AgentLoopParams } from '../types'

const wireSchema = z.object({
  input: z.array(z.object({ role: z.string().optional(), content: z.unknown().optional() })),
  temperature: z.number().optional()
})

function fixture(contextOwner: AgentLoopParams['contextOwner'], invalidInput = false, status = 200) {
  const requests: z.infer<typeof wireSchema>[] = []
  const effects: string[] = []
  const plugin: AiPlugin = {
    name: 'single-step-test',
    configureContext(context) {
      context.middlewares = [
        ...(context.middlewares ?? []),
        simulateStreamingMiddleware(),
        {
          specificationVersion: 'v3',
          transformParams: async ({ params }) => ({ ...params, temperature: 0.125 })
        }
      ]
    }
  }
  const agent = new Agent({
    contextOwner,
    providerId: 'openai',
    modelId: 'gpt-4.1',
    providerSettings: {
      apiKey: 'fixture',
      fetch: async (_url, init) => {
        requests.push(wireSchema.parse(JSON.parse(String(init?.body))))
        if (status !== 200)
          return Response.json({ error: { message: 'Unavailable', type: 'server_error' } }, { status })
        return Response.json({
          id: `response-${requests.length}`,
          created_at: 0,
          model: 'gpt-4.1',
          output:
            requests.length === 1
              ? [
                  {
                    type: 'function_call',
                    id: 'fc-1',
                    call_id: 'call-1',
                    name: 'lookup',
                    arguments: invalidInput ? '{' : '{"query":"skills"}'
                  }
                ]
              : [
                  {
                    type: 'message',
                    id: 'message-1',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'Done', annotations: [] }]
                  }
                ],
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      }
    },
    plugins: [plugin],
    tools: {
      lookup: {
        inputSchema: z.object({ query: z.string() }),
        execute: async () => {
          effects.push('execute')
          return 'Found'
        }
      }
    },
    options: {
      maxRetries: 3,
      repairToolCall: async () => {
        effects.push('repair')
        return null
      }
    },
    hookParts: [
      {
        prepareStep: () => {
          effects.push('prepare')
          return undefined
        },
        onStepFinish: () => {
          effects.push('usage')
        }
      }
    ]
  })
  return { agent, requests, effects }
}

async function stream(agent: Agent, signal = new AbortController().signal): Promise<UIMessageChunk[]> {
  const reader = agent
    .stream(
      [
        { id: 'system', role: 'system', parts: [{ type: 'text', text: 'Client skill catalog' }] },
        { id: 'first', role: 'user', parts: [{ type: 'text', text: 'Which skills?' }] },
        { id: 'second', role: 'user', parts: [{ type: 'text', text: 'List them.' }] }
      ],
      signal
    )
    .getReader()
  const chunks: UIMessageChunk[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(value)
  }
}

describe('caller-owned single model invocation', () => {
  it.each(['stream', 'generate'] as const)(
    '%s returns tool calls without local execution or continuation',
    async (mode) => {
      const { agent, requests, effects } = fixture('caller')
      if (mode === 'stream') {
        const chunks = await stream(agent)
        expect(chunks).toContainEqual(
          expect.objectContaining({ type: 'tool-input-available', toolName: 'lookup', toolCallId: 'call-1' })
        )
        expect(requests[0].input.map((message) => message.role)).toEqual(['system', 'user'])
      } else {
        expect((await agent.generate({ prompt: 'Which skills?' })).finishReason).toBe('tool-calls')
      }
      expect(requests).toHaveLength(1)
      expect(requests[0].temperature).toBe(0.125)
      expect(effects).toEqual(['usage'])
    }
  )

  it.each(['stream', 'generate'] as const)('%s keeps the Cherry tool loop for ordinary chat', async (mode) => {
    const { agent, requests, effects } = fixture(undefined)
    if (mode === 'stream') {
      expect(await stream(agent)).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Done' }))
    } else {
      expect((await agent.generate({ prompt: 'Which skills?' })).text).toBe('Done')
    }
    expect(requests).toHaveLength(2)
    expect(effects.filter((effect) => effect === 'execute')).toEqual(['execute'])
  })

  it('returns invalid tool input without invoking AI repair', async () => {
    const { agent, requests, effects } = fixture('caller', true)
    expect(await stream(agent)).toContainEqual(
      expect.objectContaining({ type: 'tool-input-error', toolCallId: 'call-1' })
    )
    expect(requests).toHaveLength(1)
    expect(effects).toEqual(['usage'])
  })

  it('surfaces provider failures without a retry', async () => {
    const { agent, requests } = fixture('caller', false, 503)
    await expect(stream(agent)).rejects.toThrow('Unavailable')
    expect(requests).toHaveLength(1)
  })

  it('does not start a request after cancellation', async () => {
    const { agent, requests } = fixture('caller')
    const controller = new AbortController()
    controller.abort()
    await stream(agent, controller.signal)
    expect(requests).toHaveLength(0)
  })
})
