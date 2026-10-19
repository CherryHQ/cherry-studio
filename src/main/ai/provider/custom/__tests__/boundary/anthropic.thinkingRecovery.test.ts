import { createHash } from 'node:crypto'

import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { wrapLanguageModel, type LanguageModelMiddleware, type UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel, makeProvider } from '../../../../__tests__/fixtures'
import { toModelMessages } from '../../../../messages/messageRules'
import { collectFromFeatures } from '../../../../runtime/aiSdk/params/collectFromFeatures'
import { INTERNAL_FEATURES } from '../../../../runtime/aiSdk/params/features/internalFeatures'
import type { RequestScope } from '../../../../runtime/aiSdk/params/scope'
import {
  dropEmptyContentParts,
  finalizeInterruptedParts,
  stripTransientStatusParts
} from '../../../../streamManager/persistence/PersistenceBackend'
import { pipeStreamLoop } from '../../../../streamManager/pipeStreamLoop'
import { withReasoningTimingMetadata } from '../../../../streamManager/withReasoningTimingMetadata'

const diagnostic =
  'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block".'

function completedResponse(modelId = 'claude-sonnet-5-5'): Response {
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
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
}

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
          expect(
            body.messages
              .filter((message: any) => message.role === 'assistant')
              .every((message: any) => message.content.length > 0),
            'synthetic empty-assistant request guard'
          ).toBe(true)
          const replay = body.messages
            .flatMap((message: any) => (message.role === 'assistant' ? message.content : []))
            .find((part: any) => part.type === 'thinking')
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
          return completedResponse(modelId)
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
      expect(bodies[1].messages[1].content).toEqual([
        { type: 'text', text: 'Looking it up.' },
        { type: 'tool_use', id: 'lookup-1', name: 'lookup', input: { query: 'q' } }
      ])
      expect(bodies[1].messages[2]).toEqual(bodies[0].messages[2])
      expect(headers.every((header) => !header.get('anthropic-beta')?.includes('thinking-binding-controls'))).toBe(true)
    }
  )

  it.each([false, true])('handles Cherry-timed thinking-only history (valid prefix: %s)', async (validPrefix) => {
    const signedPrefix = [{ role: 'user', content: [{ type: 'text', text: 'original prefix' }] }]
    const signature = createHash('sha256').update(JSON.stringify(signedPrefix)).digest('hex')
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'Thinking through the question' },
      { type: 'reasoning-delta', id: 'r1', delta: '', providerMetadata: { anthropic: { signature } } },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'finish' }
    ]
    const accumulated = await pipeStreamLoop(
      withReasoningTimingMetadata(
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk)
            controller.close()
          }
        })
      ),
      new AbortController().signal,
      { onChunk: () => {} }
    )
    expect(accumulated.accumulationError).toBeUndefined()
    expect(accumulated.threw).toBeUndefined()
    const parts = finalizeInterruptedParts(
      dropEmptyContentParts(stripTransientStatusParts(accumulated.finalMessage!.parts)),
      'paused'
    )
    const prompt = (await toModelMessages([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: validPrefix ? 'original prefix' : 'edited prefix' }] },
      { ...accumulated.finalMessage!, parts },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'next question' }] }
    ])) as LanguageModelV3CallOptions['prompt']
    expect(prompt[1].content).toEqual([
      {
        type: 'reasoning',
        text: 'Thinking through the question',
        providerOptions: {
          anthropic: { signature },
          cherry: { startedAt: expect.any(Number), thinkingMs: expect.any(Number) }
        }
      }
    ])
    const original = structuredClone(prompt)
    const bodies: any[] = []
    const statuses: number[] = []
    const sdkModel = createAnthropic({
      apiKey: 'test',
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        bodies.push(body)
        const assistants = body.messages.filter((message: any) => message.role === 'assistant')
        expect(
          assistants.every((message: any) => message.content.length > 0),
          'synthetic empty-assistant request guard'
        ).toBe(true)
        const replay = assistants
          .flatMap((message: any) => message.content)
          .find((part: any) => part.type === 'thinking')
        if (
          replay &&
          replay.signature !==
            createHash('sha256')
              .update(JSON.stringify(body.messages.slice(0, 1)))
              .digest('hex')
        ) {
          statuses.push(400)
          return Response.json(
            { type: 'error', error: { type: 'invalid_request_error', message: diagnostic } },
            { status: 400 }
          )
        }
        statuses.push(200)
        return completedResponse()
      }
    })('claude-sonnet-5-5')
    const requestScope = {
      provider: makeProvider({
        id: 'custom',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic', baseUrl: 'https://test' } }
      }),
      model: makeModel({ id: 'custom::claude-sonnet-5-5', providerId: 'custom' }),
      aiSdkProviderId: 'anthropic',
      endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      request: {
        conversation: { id: 'thinking-only' },
        contextOwner: 'caller',
        anthropicThinkingRecovery: { records: [], record: (record: unknown) => records.push(record) }
      },
      contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, enabled: false }
    } as unknown as RequestScope
    const records: unknown[] = []
    const context = { middlewares: [] as LanguageModelMiddleware[] } as AiRequestContext
    for (const plugin of collectFromFeatures(requestScope, INTERNAL_FEATURES).modelAdapters)
      await plugin.configureContext?.(context)
    const model = wrapLanguageModel({ model: sdkModel, middleware: context.middlewares! })
    try {
      const result = await model.doStream({ prompt })
      const answer: string[] = []
      for await (const chunk of result.stream) {
        expect(chunk.type).not.toBe('error')
        if (chunk.type === 'text-delta') answer.push(chunk.delta)
      }
      expect(answer).toEqual(['Completed.'])
    } finally {
      expect(bodies[0].messages[1]).toEqual({
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Thinking through the question', signature }]
      })
      expect(prompt).toEqual(original)
    }
    expect(bodies).toHaveLength(validPrefix ? 1 : 2)
    expect(statuses).toEqual(validPrefix ? [200] : [400, 200])
    if (validPrefix) {
      expect(records).toEqual([])
      expect(requestScope.request.anthropicThinkingRecovery?.records).toEqual([])
    } else {
      expect(bodies[1].messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'edited prefix' },
            { type: 'text', text: 'next question' }
          ]
        }
      ])
      expect(JSON.stringify(bodies[1])).not.toContain(signature)
      expect(records).toEqual([
        {
          endpointKey: JSON.stringify(['custom', 'anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'https://test']),
          identities: [signature]
        }
      ])
    }
  })
})
