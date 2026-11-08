import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createExecutor } from '@cherrystudio/ai-core'
import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { AiHubMixExtension } from '../../../../../provider/extensions'
import type { AppProviderSettingsMap } from '../../../../../types'
import type { RequestScope } from '../../scope'
import { providerUrlContextFeature } from '../providerUrlContext'
import { providerWebSearchFeature } from '../providerWebSearch'

const config = { anthropic: { maxUses: 3, blockedDomains: ['blocked.example'] } }
async function request(
  model: string,
  plugins: ReturnType<typeof providerToolPlugin>[],
  providerId: 'anthropic' | 'aihubmix' = 'anthropic'
) {
  let body: any
  const executor = await createExecutor<AppProviderSettingsMap, typeof providerId>(
    providerId,
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
    plugins
  )
  await executor.generateText({ model: await executor.resolveLanguageModel(model), prompt: 'hello' })
  return body.tools
}

describe('Anthropic web tool schema', () => {
  beforeAll(() => {
    extensionRegistry.register(AiHubMixExtension)
  })
  afterAll(() => {
    extensionRegistry.unregister('aihubmix')
  })
  it('downgrades older Claude to the basic web tool schema', async () => {
    const tools = await request('claude-opus-4-5', [
      providerToolPlugin('webSearch', { anthropic: { ...config.anthropic, schema: 'basic' } }),
      providerToolPlugin('urlContext', { anthropic: { ...config.anthropic, schema: 'basic' } })
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
      providerToolPlugin('webSearch', { anthropic: { ...config.anthropic, schema: 'dynamic' } }),
      providerToolPlugin('urlContext', { anthropic: { ...config.anthropic, schema: 'dynamic' } })
    ])
    expect(tools.map((tool: any) => tool.type)).toEqual(['web_search_20260209', 'web_fetch_20260209'])
  })
  it('selects the schema per request through the web search feature', async () => {
    for (const [id, type] of [
      ['claude-opus-4-5', 'web_search_20250305'],
      ['claude-opus-4-6', 'web_search_20260209']
    ]) {
      const scope = {
        model: { id, apiModelId: id },
        sdkConfig: { providerId: 'anthropic' },
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        capabilities: { webSearchPluginConfig: config }
      } as RequestScope
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
          sdkConfig: { providerId: 'anthropic' },
          endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
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
        sdkConfig: { providerId: 'anthropic' },
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        capabilities: { webSearchPluginConfig: config }
      } as RequestScope
      const tools = await request(id ?? 'production-chat', [
        ...(providerWebSearchFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[]),
        ...(providerUrlContextFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[])
      ])
      expect(tools.map((tool: any) => tool.type)).toEqual(['web_search_20260209', 'web_fetch_20260209'])
    }
  })

  it.each(['anthropic', 'aihubmix'] as const)(
    'preserves tool settings and selects both schemas through the %s runtime',
    async (providerId) => {
      for (const [apiModelId, searchType, fetchType] of [
        ['claude-opus-4-5', 'web_search_20250305', 'web_fetch_20250910'],
        ['claude-opus-4-6', 'web_search_20260209', 'web_fetch_20260209'],
        ['claude-opus-4-5', 'web_search_20250305', 'web_fetch_20250910']
      ]) {
        const scope = {
          model: { id: `custom-gw::${apiModelId}`, apiModelId, providerId: 'custom-gw' },
          sdkConfig: { providerId },
          endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
          capabilities: { webSearchPluginConfig: { ...config, [providerId]: config.anthropic } }
        } as RequestScope
        const tools = await request(
          apiModelId,
          [
            ...(providerWebSearchFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[]),
            ...(providerUrlContextFeature.contributeModelAdapters!(scope) as ReturnType<typeof providerToolPlugin>[])
          ],
          providerId
        )
        expect(tools).toEqual([
          { name: 'web_search', type: searchType, max_uses: 3, blocked_domains: ['blocked.example'] },
          { name: 'web_fetch', type: fetchType }
        ])
      }
    }
  )

  it('keeps Gemini search and URL context available through the same features', async () => {
    let body: any
    const fields: Pick<RequestScope, 'model' | 'sdkConfig' | 'endpointType' | 'capabilities'> = {
      model: {
        id: 'custom-gw::gemini-2.5-pro',
        apiModelId: 'gemini-2.5-pro',
        providerId: 'custom-gw',
        name: 'Gemini',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      },
      sdkConfig: {
        providerId: 'google',
        providerOptionsKey: 'google',
        providerSettings: {},
        modelId: 'gemini-2.5-pro'
      },
      endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      capabilities: {
        enableReasoning: false,
        enableGenerateImage: false,
        isSupportedToolUse: true,
        streamOutput: true,
        webSearchPluginConfig: {}
      }
    }
    const scope = fields as RequestScope
    const executor = await createExecutor(
      'google',
      {
        apiKey: 'test',
        fetch: async (_input, init) => {
          body = JSON.parse(init!.body as string)
          return Response.json({
            candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
          })
        }
      },
      [
        ...providerWebSearchFeature.contributeModelAdapters!(scope),
        ...providerUrlContextFeature.contributeModelAdapters!(scope)
      ]
    )
    await executor.generateText({ model: await executor.resolveLanguageModel('gemini-2.5-pro'), prompt: 'hello' })
    expect(body.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }])
  })
})
