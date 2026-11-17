import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { generateText, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import { generateText as aiCoreGenerateText } from '@cherrystudio/ai-core'
import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'

import type { RequestScope } from '../../scope'
import { createQwenAnthropicWebToolsMiddleware, qwenAnthropicWebToolsFeature } from '../qwenAnthropicWebTools'

const marker = 'x-anthropic-billing-header: cc_entrypoint=cli;'

describe('Qwen Anthropic web tools', () => {
  it.each([
    { url: 'https://example.com/' },
    { urls: ['https://example.com/', 'https://example.org/'], goal: 'Read both pages' }
  ])('consumes provider-executed fetch input %j without a repair request', async (input) => {
    let requests = 0
    const result = await aiCoreGenerateText(
      'anthropic',
      {
        apiKey: 'test',
        fetch: async () => {
          requests++
          return Response.json({
            id: 'msg_fetch',
            type: 'message',
            role: 'assistant',
            model: 'qwen3.8-max',
            content: [
              { type: 'server_tool_use', id: 'srvtoolu_fetch', name: 'web_fetch', input },
              {
                type: 'web_fetch_tool_result',
                tool_use_id: 'srvtoolu_fetch',
                content: {
                  type: 'web_fetch_result',
                  url: 'https://example.com/',
                  retrieved_at: '2026-10-29T00:00:00Z',
                  content: {
                    type: 'document',
                    title: 'Example Domain',
                    source: { type: 'text', media_type: 'text/plain', data: 'Public page content' }
                  }
                }
              },
              { type: 'text', text: 'Grounded answer' }
            ],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 2 }
          })
        }
      },
      {
        model: 'qwen3.8-max',
        prompt: 'Read both pages',
        experimental_repairToolCall: async () => {
          throw new Error('Native fetch must not need AI repair')
        }
      },
      [
        providerToolPlugin('webSearch'),
        providerToolPlugin('urlContext'),
        ...qwenAnthropicWebToolsFeature.contributeModelAdapters!({} as RequestScope)
      ]
    )
    expect(requests).toBe(1)
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'urlContext', providerExecuted: true, input })
    expect(result.toolCalls[0]).not.toHaveProperty('invalid', true)
    expect(result.toolResults[0]).toMatchObject({
      toolName: 'urlContext',
      output: { content: { source: { data: 'Public page content' } } }
    })
  })
  it.each(['dashscope', 'qwencloud'])(
    'limits the identifier to %s Anthropic requests, including copied presets',
    (presetProviderId) => {
      const scope = {
        provider: { id: 'my-provider', presetProviderId },
        endpointType: 'anthropic-messages'
      } as RequestScope
      expect(qwenAnthropicWebToolsFeature.applies!(scope)).toBe(true)
      expect(qwenAnthropicWebToolsFeature.applies!({ ...scope, endpointType: 'openai-responses' })).toBe(false)
      expect(
        qwenAnthropicWebToolsFeature.applies!({ ...scope, provider: { id: 'anthropic' } as RequestScope['provider'] })
      ).toBe(false)
    }
  )

  it.each([false, true])(
    'serializes SDK-native search and optional fetch (%s) with the required system identifier',
    async (fetchEnabled) => {
      let request: Record<string, any> = {}
      const anthropic = createAnthropic({
        apiKey: 'test',
        fetch: async (_input, init) => {
          request = JSON.parse(init!.body as string)
          return Response.json({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'qwen3.8-max',
            content: [{ type: 'text', text: 'Grounded answer' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 2 }
          })
        }
      })
      const result = await generateText({
        model: wrapLanguageModel({
          model: anthropic('qwen3.8-max'),
          middleware: createQwenAnthropicWebToolsMiddleware()
        }),
        messages: [
          {
            role: 'system',
            content: 'Keep the assistant instructions.',
            providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
          },
          { role: 'user', content: 'Read https://example.com and search for related information.' }
        ],
        tools: {
          webSearch: anthropic.tools.webSearch_20260209({ maxUses: 3, blockedDomains: ['blocked.example'] }),
          ...(fetchEnabled ? { urlContext: anthropic.tools.webFetch_20260209({ maxUses: 2 }) } : {})
        }
      })
      expect(result.text).toBe('Grounded answer')
      expect(request.system).toEqual([
        { type: 'text', text: marker },
        { type: 'text', text: 'Keep the assistant instructions.', cache_control: { type: 'ephemeral' } }
      ])
      expect(request.tools).toContainEqual(
        expect.objectContaining({
          name: 'web_search',
          type: 'web_search_20260209',
          max_uses: 3,
          blocked_domains: ['blocked.example']
        })
      )
      expect(request.tools.filter((tool: { name: string }) => tool.name === 'web_fetch')).toHaveLength(
        fetchEnabled ? 1 : 0
      )
    }
  )

  it('does not activate native search for ordinary or same-named function tools', async () => {
    const middleware = createQwenAnthropicWebToolsMiddleware()
    for (const tools of [
      undefined,
      [{ type: 'function' as const, name: 'web_search', inputSchema: { type: 'object' as const } }]
    ]) {
      const params: LanguageModelV3CallOptions = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        tools
      }
      expect(await middleware.transformParams!({ type: 'generate', params, model: {} as never })).toEqual(params)
    }
  })

  it('keeps retries and continued turns from duplicating the identifier', async () => {
    const middleware = createQwenAnthropicWebToolsMiddleware()
    const params: LanguageModelV3CallOptions = {
      prompt: [
        { role: 'system', content: marker },
        { role: 'user', content: [{ type: 'text', text: 'Continue' }] }
      ],
      tools: [{ type: 'provider', id: 'anthropic.web_fetch_20260209', name: 'urlContext', args: {} }]
    }
    expect(await middleware.transformParams!({ type: 'stream', params, model: {} as never })).toEqual(params)
  })
})
