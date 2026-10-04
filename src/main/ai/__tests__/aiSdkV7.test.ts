import { createAnthropic } from '@ai-sdk/anthropic'
import {
  generateText,
  isStepCount,
  readUIMessageStream,
  tool,
  ToolLoopAgent,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk
} from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createAgent } from '@cherrystudio/ai-core'
import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

describe('AI SDK v7 retained application contracts', () => {
  it('keeps inline and URL PDF attachments on the Anthropic wire through the V4 provider', async () => {
    let body: Record<string, any> | undefined
    const provider = createAnthropic({
      apiKey: 'test',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return Response.json({
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'Read both files' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 3 }
        })
      }
    })
    const result = await generateText({
      model: provider('claude-sonnet-4-5'),
      instructions: 'Read the files.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: 'application/pdf',
              filename: 'inline.pdf',
              data: { type: 'data', data: Buffer.from('%PDF-1.4') }
            },
            {
              type: 'file',
              mediaType: 'application/pdf',
              data: { type: 'url', url: new URL('https://files.example/report.pdf') }
            }
          ]
        }
      ]
    })
    expect(result.text).toBe('Read both files')
    expect(body?.messages[0].content).toMatchObject([
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') }
      },
      { type: 'document', source: { type: 'url', url: 'https://files.example/report.pdf' } }
    ])
  })

  it('resumes an approved transformed tool exactly once with the request context', async () => {
    const effects: string[] = []
    let calls = 0
    const agent = new ToolLoopAgent({
      model: new MockLanguageModelV4({
        doGenerate: async () => ({
          content:
            calls++ === 0
              ? [{ type: 'tool-call', toolCallId: 'double-1', toolName: 'double', input: '{"value":"21"}' }]
              : [{ type: 'text', text: '42' }],
          finishReason: { unified: calls === 1 ? 'tool-calls' : 'stop', raw: undefined },
          usage,
          warnings: []
        })
      }),
      tools: {
        double: tool({
          inputSchema: z.object({ value: z.string().transform(Number) }),
          contextSchema: z.object({ requestId: z.string() }),
          needsApproval: true,
          execute: async ({ value }, { context }) => {
            effects.push(`${context.requestId}:${value}`)
            return value * 2
          }
        })
      },
      toolsContext: { double: { requestId: 'request-1' } },
      stopWhen: isStepCount(3)
    })
    const user: ModelMessage = { role: 'user', content: 'Double 21' }
    const pending = await agent.generate({ messages: [user] })
    expect(effects).toEqual([])
    const request = pending.finalStep.content.find((part) => part.type === 'tool-approval-request')
    if (request?.type !== 'tool-approval-request') throw new Error('Missing approval request')
    const result = await agent.generate({
      messages: [
        user,
        ...pending.finalStep.response.messages,
        { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: request.approvalId, approved: true }] }
      ]
    })
    expect(result.finalStep.text).toBe('42')
    expect(effects).toEqual(['request-1:21'])
  })

  it('retains nested UI snapshots when later chunks update tool input and metadata', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start', messageId: 'assistant-1', messageMetadata: { nested: { phase: 'start' } } },
      { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'lookup' },
      { type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta: '{"nested":{"query":"first' },
      { type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta: ' second"}}' },
      {
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'lookup',
        input: { nested: { query: 'first second' } }
      },
      { type: 'message-metadata', messageMetadata: { nested: { phase: 'end' } } },
      { type: 'text-start', id: 'text-1' },
      ...Array.from({ length: 1000 }, () => ({ type: 'text-delta' as const, id: 'text-1', delta: 'x' })),
      { type: 'text-end', id: 'text-1' },
      { type: 'finish', finishReason: 'stop' }
    ]
    const snapshots: Array<{ message: UIMessage; json: string }> = []
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk))
        controller.close()
      }
    })
    for await (const message of readUIMessageStream({ stream }))
      snapshots.push({ message, json: JSON.stringify(message) })
    expect(snapshots.every(({ message, json }) => JSON.stringify(message) === json)).toBe(true)
    const last = snapshots.at(-1)?.message
    expect(last?.metadata).toEqual({ nested: { phase: 'end' } })
    expect(last?.parts.find((part) => part.type === 'text')).toMatchObject({ text: 'x'.repeat(1000), state: 'done' })
    expect(last?.parts[0]).toMatchObject({ input: { nested: { query: 'first second' } } })
  })

  it('keeps provider-native search on the server without executing the local fallback', async () => {
    let body: Record<string, any> | undefined
    let localCalls = 0
    const agent = await createAgent({
      providerId: 'openai',
      modelId: 'gpt-4o',
      providerSettings: {
        apiKey: 'test',
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body))
          return Response.json({
            id: 'resp-1',
            created_at: 0,
            model: 'gpt-4o',
            status: 'completed',
            output: [
              {
                type: 'web_search_call',
                id: 'search-1',
                status: 'completed',
                action: { type: 'search', query: 'cherry' }
              },
              {
                type: 'message',
                id: 'message-1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Found cherries', annotations: [] }]
              }
            ],
            usage: { input_tokens: 5, output_tokens: 3 }
          })
        }
      },
      plugins: [providerToolPlugin('webSearch')],
      agentSettings: {
        tools: {
          webSearch: tool({
            inputSchema: z.object({ query: z.string() }),
            execute: async () => {
              localCalls++
              return 'local'
            }
          })
        }
      }
    })
    const result = await agent.generate({ prompt: 'Search for cherries' })
    expect(result.finalStep.text).toBe('Found cherries')
    expect(body?.tools).toContainEqual(expect.objectContaining({ type: 'web_search' }))
    expect(result.finalStep.toolCalls[0]).toMatchObject({ providerExecuted: true, toolName: 'webSearch' })
    expect(localCalls).toBe(0)
  })
})
