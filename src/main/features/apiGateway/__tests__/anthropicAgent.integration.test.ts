import { resolve } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'
import type { Message, MessageCreateParamsNonStreaming, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import '@data/services/ProviderRegistryService'
import { AiService } from '@main/ai/AiService'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode/claudeContext'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import type * as CustomFetch from '@main/ai/utils/customFetch'
import { BaseService } from '@main/core/lifecycle'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { processMessage } from '../proxyStream'

const mocks = vi.hoisted(() => ({
  internal: true,
  sessionId: 'agent-session',
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
      getAgentSessionId: () => (mocks.internal ? mocks.sessionId : undefined),
      resolveAgentSessionUsage: () =>
        mocks.internal ? { agentSessionId: mocks.sessionId, assistantMessageId: 'answer', source: null } : undefined
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

async function request(
  messages: MessageParam[],
  stream = false,
  overrides: Partial<MessageCreateParamsNonStreaming> = {}
): Promise<Message> {
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
    messages,
    ...overrides
  }
  return stream ? client.messages.stream(params).finalMessage() : client.messages.create(params)
}

describe('internal Anthropic agent through the production gateway and SDK', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    BaseService.resetInstances()
    mocks.internal = true
    mocks.sessionId = 'agent-session'
    mocks.manager = new AiStreamManager()
    mocks.ai = new AiService()
    mocks.transport.mockReset()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'agent-workspace', name: 'Workspace', path: '/workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'agent-session', name: 'Session', workspaceId: 'agent-workspace', orderKey: 'a0' })
      .run()
    prepareClaudeBranch('agent-session', '/workspace/.claude')
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
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://openai.test/v1' },
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://google.test/v1beta', adapterFamily: 'google' },
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://openai.test/v1' }
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

  function addModel(modelId: string, endpointType: (typeof ENDPOINT_TYPE)[keyof typeof ENDPOINT_TYPE]) {
    dbh.db
      .insert(userModelTable)
      .values({
        id: `wire::${modelId}`,
        providerId: 'wire',
        modelId,
        name: modelId,
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a1',
        endpointTypes: [endpointType]
      })
      .run()
  }

  it('restores a Gemini 4 tool signature after reopen, pins its continuation, and cleans completed foreign history', async () => {
    const gemini = 'gemini-4-flash'
    const other = 'gemini-4-pro'
    addModel(gemini, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    addModel(other, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)
    const signature = Buffer.from('gemini-tool-state').toString('base64')
    const upstream: Array<{
      url: string
      body: { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }
    }> = []
    mocks.transport.mockImplementation(async (url, init) => {
      upstream.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      const parts =
        upstream.length === 1
          ? [{ functionCall: { id: 'call_google', name: 'echo', args: { value: 7 } }, thoughtSignature: signature }]
          : [{ text: `Done ${upstream.length}` }]
      const response = {
        candidates: [{ index: 0, content: { role: 'model', parts }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }
      }
      return new Response(`data: ${JSON.stringify(response)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    })
    const user: MessageParam = { role: 'user', content: 'Call echo' }
    const first = await request([user], true, { model: `wire:${gemini}` })
    const call = first.content.find((block) => block.type === 'tool_use')!
    expect(call).toMatchObject({ name: 'echo', input: { value: 7 } })
    const history: MessageParam[] = [
      user,
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: '7' }] }
    ]

    BaseService.resetInstances()
    mocks.manager = new AiStreamManager()
    mocks.ai = new AiService()
    dbh.db
      .update(userModelTable)
      .set({ isEnabled: false })
      .where(eq(userModelTable.id, `wire::${other}`))
      .run()
    const continued = await request(history, false, { model: `wire:${other}` })
    dbh.db
      .update(userModelTable)
      .set({ isEnabled: true })
      .where(eq(userModelTable.id, `wire::${other}`))
      .run()
    expect(upstream[1].url).toContain(`/models/${gemini}:streamGenerateContent`)
    expect(upstream[1].body.contents.flatMap(({ parts }) => parts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionCall: expect.objectContaining({ name: 'echo' }),
          thoughtSignature: signature
        }),
        expect.objectContaining({ functionResponse: expect.objectContaining({ name: 'echo' }) })
      ])
    )

    const completed: MessageParam[] = [
      ...history,
      { role: 'assistant', content: continued.content },
      { role: 'user', content: 'Follow up' }
    ]
    await request(completed, false, { model: `wire:${other}` })
    expect(upstream[2].url).toContain(`/models/${other}:streamGenerateContent`)
    const parts = upstream[2].body.contents.flatMap(({ parts }) => parts)
    expect(parts).toEqual(
      expect.arrayContaining([
        { functionCall: expect.objectContaining({ name: 'echo', args: { value: 7 } }) },
        expect.objectContaining({ functionResponse: expect.objectContaining({ name: 'echo' }) })
      ])
    )
    await request(completed, false, { model: `wire:${gemini}` })
    expect(upstream[3].body.contents.flatMap(({ parts }) => parts)).toContainEqual(
      expect.objectContaining({ functionCall: expect.objectContaining({ name: 'echo' }), thoughtSignature: signature })
    )
    dbh.db
      .update(userModelTable)
      .set({ isEnabled: false })
      .where(eq(userModelTable.id, `wire::${gemini}`))
      .run()
    await expect(request(history, false, { model: `wire:${other}` })).rejects.toThrow()
    expect(upstream).toHaveLength(4)
  })

  it.each(['openai', 'open-responses'] as const)(
    'replays empty %s reasoning only for unambiguous history in its own session',
    async (adapterFamily) => {
      const model = 'wire:o3'
      addModel('o3', ENDPOINT_TYPE.OPENAI_RESPONSES)
      dbh.db
        .update(userProviderTable)
        .set({
          endpointConfigs: { [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://openai.test/v1', adapterFamily } }
        })
        .where(eq(userProviderTable.providerId, 'wire'))
        .run()
      const sent: Array<{ store?: boolean; input: Array<Record<string, unknown>> }> = []
      mocks.transport.mockImplementation(async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)))
        const id = sent.length
        const reasoning = { type: 'reasoning', id: `rs_${id}`, summary: [], encrypted_content: `cipher-${id}` }
        const message = {
          type: 'message',
          id: `msg_${id}`,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: `Answer ${id}`, annotations: [] }]
        }
        const events = [
          { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, encrypted_content: null } },
          { type: 'response.output_item.done', output_index: 0, item: reasoning },
          { type: 'response.output_item.added', output_index: 1, item: { ...message, content: [] } },
          {
            type: 'response.output_text.delta',
            item_id: message.id,
            output_index: 1,
            content_index: 0,
            delta: `Answer ${id}`
          },
          { type: 'response.output_item.done', output_index: 1, item: message },
          {
            type: 'response.completed',
            response: {
              id: `resp_${id}`,
              object: 'response',
              created_at: 1,
              model: 'o3',
              status: 'completed',
              output: [reasoning, message],
              usage: { input_tokens: 10, output_tokens: 5 }
            }
          }
        ]
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' }
        })
      })
      const history: MessageParam[] = [{ role: 'user', content: 'Hello' }]
      for (let turn = 1; turn <= 3; turn++) {
        const reply = await request(history, turn % 2 === 1, { model })
        expect(reply.content).toMatchObject([
          { type: 'thinking', thinking: '' },
          { type: 'text', text: `Answer ${turn}` }
        ])
        history.push({ role: 'assistant', content: reply.content }, { role: 'user', content: `Follow-up ${turn}` })
      }
      if (adapterFamily === 'openai') expect(sent[2].store).toBe(false)
      expect(sent[2].input.filter((item) => item.type === 'reasoning')).toMatchObject([
        { encrypted_content: 'cipher-1' },
        { encrypted_content: 'cipher-2' }
      ])
      expect(sent[2].input.some((item) => item.type === 'item_reference')).toBe(false)

      const repeated = [history[0], history[1], { role: 'user' as const, content: 'Continue' }, ...history.slice(1)]
      await request(repeated, false, { model })
      expect(sent[3].input.filter((item) => item.type === 'reasoning')).toMatchObject([
        { encrypted_content: 'cipher-2' },
        { encrypted_content: 'cipher-3' }
      ])

      dbh.db
        .insert(agentSessionTable)
        .values({ id: 'other-session', name: 'Other', workspaceId: 'agent-workspace', orderKey: 'a1' })
        .run()
      prepareClaudeBranch('other-session', '/workspace/.claude')
      mocks.sessionId = 'other-session'
      await request(history, false, { model })
      expect(sent[4].input.filter((item) => item.type === 'reasoning')).toEqual([])
    }
  )

  it('freezes the admitted price even when pricing changes while the provider runs', async () => {
    mocks.transport.mockImplementation(async () => {
      dbh.db
        .update(userModelTable)
        .set({
          pricing: {
            input: { perMillionTokens: 200, currency: 'USD' },
            output: { perMillionTokens: 400, currency: 'USD' }
          }
        })
        .where(eq(userModelTable.id, 'wire::wire-model'))
        .run()
      return anthropicResponse(false)
    })
    await request([{ role: 'user', content: 'Hello' }])
    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ inputTokens: 10, outputTokens: 5 })
    expect(rows[0].cost).toBeCloseTo(0.00004, 8)
    expect(modelService.getByKey('wire', 'wire-model').pricing?.input?.perMillionTokens).toBe(200)
  })

  it('does not duplicate a tool-call cache marker onto its unmarked result', async () => {
    let body: { messages: Array<{ content: Array<{ type: string; cache_control?: unknown }> }> } = { messages: [] }
    mocks.transport.mockImplementation(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return anthropicResponse(false)
    })
    const marker = { type: 'ephemeral', ttl: '1h' } as const
    await request([
      { role: 'user', content: 'Run echo' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call-marker', name: 'echo', input: {}, cache_control: marker }]
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-marker', content: 'done' }] }
    ])
    const blocks = body.messages.flatMap((message) => message.content)
    expect(blocks.find((block) => block.type === 'tool_use')?.cache_control).toEqual(marker)
    expect(blocks.find((block) => block.type === 'tool_result')?.cache_control).toBeUndefined()
    expect(blocks.filter((block) => block.cache_control)).toHaveLength(1)
  })

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

  it.each([false, true])(
    'preserves caller cache boundaries, schema and failed tool results on the wire (stream=%s)',
    async (stream) => {
      const upstream: Array<Record<string, unknown>> = []
      mocks.transport.mockImplementation(async (_url, init) => {
        upstream.push(JSON.parse(String(init?.body)))
        return anthropicResponse(false)
      })
      const longCache = { type: 'ephemeral', ttl: '1h' } as const
      const shortCache = { type: 'ephemeral', ttl: '5m' } as const
      const schema = {
        type: 'object' as const,
        properties: { value: { $ref: '#/definitions/value' } },
        definitions: { value: { oneOf: [{ type: 'integer' as const }, { type: 'string' as const }] } },
        required: ['value'],
        additionalProperties: false
      }
      const result = await request(
        [
          { role: 'user', content: [{ type: 'text', text: 'Run echo', cache_control: shortCache }] },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'failed-1', name: 'echo', input: { value: 7 } }] },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'failed-1',
                content: 'Permission denied',
                is_error: true,
                cache_control: shortCache
              }
            ]
          }
        ],
        stream,
        {
          system: [
            { type: 'text', text: 'Harness skills', cache_control: longCache },
            { type: 'text', text: 'Current task' }
          ],
          tools: [{ name: 'echo', input_schema: schema, cache_control: longCache }],
          tool_choice: { type: 'auto', disable_parallel_tool_use: true }
        }
      )
      expect(result.content).toMatchObject([{ type: 'text', text: 'Done' }])
      expect(upstream).toHaveLength(1)
      expect(upstream[0]).toMatchObject({
        system: [
          { type: 'text', text: 'Harness skills', cache_control: longCache },
          { type: 'text', text: 'Current task' }
        ],
        tools: [{ name: 'echo', input_schema: schema, cache_control: longCache }],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([{ type: 'text', text: 'Run echo', cache_control: shortCache }])
          }),
          expect.objectContaining({
            role: 'assistant',
            content: expect.arrayContaining([{ type: 'tool_use', id: 'failed-1', name: 'echo', input: { value: 7 } }])
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              {
                type: 'tool_result',
                tool_use_id: 'failed-1',
                content: 'Permission denied',
                is_error: true,
                cache_control: shortCache
              }
            ])
          })
        ])
      })
      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(1)
    }
  )

  it.each([{ type: 'none' }, { type: 'auto' }, { type: 'any' }, { type: 'tool', name: 'echo' }] as const)(
    'preserves explicit tool choice $type',
    async (toolChoice) => {
      let body: Record<string, unknown> = {}
      mocks.transport.mockImplementation(async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return anthropicResponse(false)
      })
      await request([{ role: 'user', content: 'Choose a tool' }], false, {
        thinking: { type: 'disabled' },
        tool_choice: toolChoice
      })
      if (toolChoice.type === 'none') {
        expect(body.tools).toBeUndefined()
        expect(body.tool_choice).toBeUndefined()
      } else expect(body.tool_choice).toMatchObject(toolChoice)
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
