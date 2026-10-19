import { createHash } from 'node:crypto'

import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel, makeProvider } from '../../../../__tests__/fixtures'
import { collectFromFeatures } from '../../../../runtime/aiSdk/params/collectFromFeatures'
import { INTERNAL_FEATURES } from '../../../../runtime/aiSdk/params/features/internalFeatures'
import type { RequestScope } from '../../../../runtime/aiSdk/params/scope'

const diagnostic =
  'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block".'

describe('production Anthropic thinking recovery HTTP boundary', () => {
  it.each(['claude-haiku-5-5', 'claude-sonnet-5-5'])(
    'recovers changed-prefix thinking and preserves tool continuation for %s',
    async (modelId) => {
      const signedPrefix = [{ role: 'user', content: [{ type: 'text', text: 'original question' }] }]
      const signature = createHash('sha256').update(JSON.stringify(signedPrefix)).digest('hex')
      const bodies: any[] = []
      const headers: Headers[] = []
      const sdkModel = createAnthropic({
        apiKey: 'test',
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body))
          bodies.push(body)
          headers.push(new Headers(init?.headers))
          const replay = body.messages[1].content.find((part: any) => part.type === 'thinking')
          if (
            replay &&
            replay.signature !==
              createHash('sha256')
                .update(JSON.stringify(body.messages.slice(0, 1)))
                .digest('hex')
          ) {
            return Response.json(
              { type: 'error', error: { type: 'invalid_request_error', message: diagnostic } },
              { status: 400 }
            )
          }
          const events = [
            {
              type: 'message_start',
              message: {
                id: 'answer',
                type: 'message',
                role: 'assistant',
                model: modelId,
                content: [],
                usage: { input_tokens: 10, output_tokens: 0 }
              }
            },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Completed.' } },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 1 }
            },
            { type: 'message_stop' }
          ]
          return new Response(
            events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
            { headers: { 'content-type': 'text/event-stream' } }
          )
        }
      })(modelId)
      const scope = {
        provider: makeProvider({
          id: 'custom',
          defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
          endpointConfigs: {
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic', baseUrl: 'https://test' }
          }
        }),
        model: makeModel({ id: `custom::${modelId}`, providerId: 'custom' }),
        aiSdkProviderId: 'anthropic',
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        request: { conversation: { id: 'probe' }, contextOwner: 'caller' },
        contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, enabled: false }
      } as unknown as RequestScope
      const context = { middlewares: [] as LanguageModelMiddleware[] } as AiRequestContext
      for (const plugin of collectFromFeatures(scope, INTERNAL_FEATURES).modelAdapters)
        await plugin.configureContext?.(context)
      expect(context.middlewares?.length).toBeGreaterThan(0)
      const model = wrapLanguageModel({ model: sdkModel, middleware: context.middlewares! })
      const prompt: LanguageModelV3CallOptions['prompt'] = [
        { role: 'user', content: [{ type: 'text', text: 'edited question' }] },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '', providerOptions: { anthropic: { signature } } },
            { type: 'reasoning', text: '', providerOptions: { anthropic: { redactedData: 'opaque-redacted' } } },
            { type: 'text', text: 'Looking it up.' },
            { type: 'tool-call', toolCallId: 'lookup-1', toolName: 'lookup', input: { query: 'q' } }
          ]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'lookup-1',
              toolName: 'lookup',
              output: { type: 'text', value: 'found' }
            }
          ]
        }
      ]
      const result = await model.doStream({
        prompt,
        tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }]
      })
      const answer: string[] = []
      for await (const chunk of result.stream) if (chunk.type === 'text-delta') answer.push(chunk.delta)
      expect(answer).toEqual(['Completed.'])
      expect(bodies).toHaveLength(2)
      expect(bodies[0].messages[1].content.map((part: any) => part.type)).toEqual([
        'thinking',
        'redacted_thinking',
        'text',
        'tool_use'
      ])
      expect(bodies[1].messages[1].content).toEqual(bodies[0].messages[1].content.slice(2))
      expect(bodies[1].messages[2]).toEqual(bodies[0].messages[2])
      expect(headers.every((header) => !header.get('anthropic-beta')?.includes('thinking-binding-controls'))).toBe(true)
    }
  )
})
