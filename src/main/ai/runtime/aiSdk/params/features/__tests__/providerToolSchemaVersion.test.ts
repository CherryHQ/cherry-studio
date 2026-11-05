import { describe, expect, it } from 'vitest'

import { generateText } from '@cherrystudio/ai-core'
import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'

import type { RequestScope } from '../../scope'
import { providerUrlContextFeature } from '../providerUrlContext'
import { providerWebSearchFeature } from '../providerWebSearch'

const config = { anthropic: { maxUses: 3, blockedDomains: ['blocked.example'] } }
async function request(model: string, plugins: ReturnType<typeof providerToolPlugin>[]) {
  let body: any
  await generateText(
    'anthropic',
    {
      apiKey: 'test',
      fetch: async (_input, init) => {
        body = JSON.parse(init!.body as string)
        return Response.json({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      }
    },
    { model, prompt: 'hello' },
    plugins
  )
  return body.tools
}

describe('Anthropic web tool schema', () => {
  it('downgrades older Claude to the basic web tool schema', async () => {
    const tools = await request('claude-opus-4-5', [
      providerToolPlugin('webSearch', config, { anthropicWebToolSchema: 'basic' }),
      providerToolPlugin('urlContext', config, { anthropicWebToolSchema: 'basic' })
    ])
    expect(tools).toContainEqual(
      expect.objectContaining({ type: 'web_search_20250305', max_uses: 3, blocked_domains: ['blocked.example'] })
    )
    expect(tools).toContainEqual(
      expect.objectContaining({ type: 'web_fetch_20250910', max_uses: 3, blocked_domains: ['blocked.example'] })
    )
  })
  it('keeps the dynamic schema when the caller asks for it', async () => {
    const tools = await request('claude-opus-4-5', [
      providerToolPlugin('webSearch', config, { anthropicWebToolSchema: 'dynamic' }),
      providerToolPlugin('urlContext', config, { anthropicWebToolSchema: 'dynamic' })
    ])
    expect(tools.map((tool: any) => tool.type)).toEqual(['web_search_20260209', 'web_fetch_20260209'])
  })
  it('selects the schema per request through the web search feature', async () => {
    for (const [id, type] of [
      ['claude-opus-4-5', 'web_search_20250305'],
      ['claude-opus-4-6', 'web_search_20260209']
    ]) {
      const scope = { model: { id, apiModelId: id }, capabilities: { webSearchPluginConfig: config } } as RequestScope
      const tools = await request(
        id,
        providerWebSearchFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[]
      )
      expect(tools[0].type).toBe(type)
    }
  })
  it.each(['anthropic', 'custom-gw'])(
    'selects both web tool schemas from the wire id across requests through %s',
    async (providerId) => {
      for (const [apiModelId, searchType, fetchType] of [
        ['claude-opus-4-5', 'web_search_20250305', 'web_fetch_20250910'],
        ['claude-opus-4-6', 'web_search_20260209', 'web_fetch_20260209']
      ]) {
        const scope = {
          model: { id: `${providerId}::${apiModelId}`, apiModelId, providerId },
          capabilities: { webSearchPluginConfig: config }
        } as RequestScope
        const tools = await request(apiModelId, [
          ...(providerWebSearchFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[]),
          ...(providerUrlContextFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[])
        ])
        expect.soft(tools.map((tool: any) => tool.type)).toEqual([searchType, fetchType])
      }
    }
  )
  it('keeps the dynamic schema for unknown models and missing model ids', async () => {
    for (const id of ['qwen3.8-max', 'production-chat', 'claude-private-preview', undefined]) {
      const scope = {
        model: id ? { id, apiModelId: id } : undefined,
        capabilities: { webSearchPluginConfig: config }
      } as RequestScope
      const tools = await request(id ?? 'production-chat', [
        ...(providerWebSearchFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[]),
        ...(providerUrlContextFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[])
      ])
      expect(tools.map((tool: any) => tool.type)).toEqual(['web_search_20260209', 'web_fetch_20260209'])
    }
  })
})
