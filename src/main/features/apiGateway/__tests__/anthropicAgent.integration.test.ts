import { resolve } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'
import type { Message, MessageCreateParamsNonStreaming, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import '@data/services/ProviderRegistryService'
import { AiService } from '@main/ai/AiService'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import type * as CustomFetch from '@main/ai/utils/customFetch'
import { BaseService } from '@main/core/lifecycle'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { processMessage } from '../proxyStream'

const mocks = vi.hoisted(() => ({
  internal: true,
  transport: vi.fn<typeof fetch>(),
  manager: undefined as AiStreamManager | undefined,
  ai: undefined as AiService | undefined
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    ...defaultServiceInstances,
    AiStreamManager: {
      streamPrompt: (input: Parameters<AiStreamManager['streamPrompt']>[0]) => mocks.manager!.streamPrompt(input),
      abort: (id: string) => mocks.manager!.abort(id, 'client disconnected')
    },
    AiService: { streamText: (input: Parameters<AiService['streamText']>[0]) => mocks.ai!.streamText(input) },
    ApiGatewayService: {
      isInternalRequest: () => mocks.internal,
      getAgentSessionId: () => (mocks.internal ? 'agent-session' : undefined),
      resolveAgentSessionUsage: () =>
        mocks.internal ? { agentSessionId: 'agent-session', assistantMessageId: 'answer', source: null } : undefined
    }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('@main/ai/utils/customFetch', async (original) => ({
  ...(await original<typeof CustomFetch>()),
  customFetch: mocks.transport
}))

function anthropicResponse(tool: boolean): Response {
  const blocks = tool
    ? ([
        { type: 'thinking', thinking: 'Check the tool', signature: 'native-signature' },
        { type: 'tool_use', id: 'tool-1', name: 'echo', input: { value: 7 } }
      ] as const)
    : ([{ type: 'text', text: 'Done' }] as const)
  const events: unknown[] = [
    {
      type: 'message_start',
      message: {
        id: tool ? 'native-1' : 'native-2',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'wire-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 }
      }
    }
  ]
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'tool_use') {
      events.push(
        { type: 'content_block_start', index, content_block: { ...block, input: {} } },
        { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: '{"value":7}' } }
      )
    } else if (block.type === 'thinking') {
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } },
        { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } }
      )
    } else {
      events.push(
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }
      )
    }
    events.push({ type: 'content_block_stop', index })
  }
  events.push(
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' }
  )
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
}

async function request(messages: MessageParam[], stream = false): Promise<Message> {
  const client = new Anthropic({
    apiKey: 'internal-key',
    baseURL: 'http://gateway.test',
    maxRetries: 0,
    fetch: async (_url, init) =>
      processMessage({
        params: JSON.parse(String(init?.body)),
        inputFormat: 'anthropic',
        outputFormat: 'anthropic',
        requestHeaders: new Headers(init?.headers)
      })
  })
  const params: MessageCreateParamsNonStreaming = {
    model: 'wire:wire-model',
    max_tokens: 2048,
    thinking: { type: 'enabled', budget_tokens: 1024 },
    tools: [{ name: 'echo', input_schema: { type: 'object', properties: { value: { type: 'number' } } } }],
    messages
  }
  return stream ? client.messages.stream(params).finalMessage() : client.messages.create(params)
}

describe('internal Anthropic agent through the production gateway and SDK', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    BaseService.resetInstances()
    mocks.internal = true
    mocks.manager = new AiStreamManager()
    mocks.ai = new AiService()
    mocks.transport.mockReset()
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, file) =>
      key === 'feature.provider_registry.data'
        ? resolve('packages/provider-registry/data', file ?? '')
        : getPath(key, file)
    )
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'wire',
        name: 'Wire provider',
        isEnabled: true,
        orderKey: 'a0',
        apiKeys: [{ id: 'upstream-key', key: 'upstream-secret', isEnabled: true }],
        providerSettings: { extraHeaders: { 'X-Upstream': 'provider-header' } },
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://anthropic.test/v1' },
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://openai.test/v1' }
        },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'wire::wire-model',
        providerId: 'wire',
        modelId: 'wire-model',
        name: 'Wire model',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a0',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
        pricing: { input: { perMillionTokens: 2, currency: 'USD' }, output: { perMillionTokens: 4, currency: 'USD' } }
      })
      .run()
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([false, true])(
    'preserves thinking/tool replay, upstream credentials and single billing (stream=%s)',
    async (stream) => {
      const upstream: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
      mocks.transport.mockImplementation(async (url, init) => {
        upstream.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
        return anthropicResponse(upstream.length === 1)
      })
      const messages: MessageParam[] = [{ role: 'user', content: 'Run echo' }]
      const first = await request(messages, stream)
      const expectedContent = [
        { type: 'thinking', thinking: 'Check the tool', signature: 'native-signature' },
        { type: 'tool_use', id: 'tool-1', name: 'echo', input: { value: 7 } }
      ]
      expect(first.content).toMatchObject(expectedContent)
      expect(first.stop_reason).toBe('tool_use')
      const final = await request(
        [
          ...messages,
          { role: 'assistant', content: first.content },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '7' }] }
        ],
        stream
      )
      expect(final.content).toMatchObject([{ type: 'text', text: 'Done' }])
      expect(upstream).toHaveLength(2)
      for (const sent of upstream) {
        expect(sent.url).toContain('https://anthropic.test/v1/messages')
        expect(sent.headers.get('x-api-key')).toBe('upstream-secret')
        expect(sent.headers.get('x-upstream')).toBe('provider-header')
        expect(sent.body.model).toBe('wire-model')
      }
      expect(upstream[1].body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: expect.arrayContaining(expectedContent.map((block) => expect.objectContaining(block)))
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({ type: 'tool_result', tool_use_id: 'tool-1', content: '7' })
            ])
          })
        ])
      )
      const rows = dbh.db.select().from(aiUsageRecordTable).all()
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(row).toMatchObject({ providerId: 'wire', messageId: 'answer', inputTokens: 10, outputTokens: 5 })
        expect(row.cost).toBeCloseTo(0.00004)
      }
      expect(modelService.getByKey('wire', 'wire-model').endpointTypes?.[0]).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    }
  )

  it.each(['external request', 'undeclared endpoint', 'unconfigured endpoint'] as const)(
    'retains the normal endpoint fallback for an %s',
    async (scenario) => {
      if (scenario === 'external request') mocks.internal = false
      if (scenario === 'undeclared endpoint') {
        dbh.db
          .update(userModelTable)
          .set({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })
          .where(eq(userModelTable.id, 'wire::wire-model'))
          .run()
      }
      if (scenario === 'unconfigured endpoint') {
        dbh.db
          .update(userProviderTable)
          .set({
            endpointConfigs: {
              [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://openai.test/v1' }
            }
          })
          .where(eq(userProviderTable.providerId, 'wire'))
          .run()
      }
      let endpoint = ''
      mocks.transport.mockImplementation(async (url) => {
        endpoint = String(url)
        return new Response(
          `data: ${JSON.stringify({
            id: 'openai-result',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'wire-model',
            choices: [{ index: 0, delta: { content: 'Done' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } }
        )
      })
      expect((await request([{ role: 'user', content: 'Hello' }])).content).toMatchObject([
        { type: 'text', text: 'Done' }
      ])
      expect(endpoint).toBe('https://openai.test/v1/chat/completions')
    }
  )
})
