// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/TopicService'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { makeModel, makeProvider } from '@main/ai/__tests__/fixtures'
import { toModelMessages } from '@main/ai/messages/messageRules'
import { collectFromFeatures } from '@main/ai/runtime/aiSdk/params/collectFromFeatures'
import { INTERNAL_FEATURES } from '@main/ai/runtime/aiSdk/params/features/internalFeatures'
import type { RequestScope } from '@main/ai/runtime/aiSdk/params/scope'
import { PersistentChatContextProvider } from '@main/ai/streamManager/context/PersistentChatContextProvider'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import type { MessageData } from '@shared/data/types/message'
import { createUniqueModelId, ENDPOINT_TYPE } from '@shared/data/types/model'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({
  notifyDataApiDataChangeMock: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({
  notifyDataApiDataChange: notifyDataApiDataChangeMock
}))

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

describe('MessageService', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    mockMainLoggerService.warn.mockClear()
    notifyDataApiDataChangeMock.mockClear()
    const [providerAKey, providerBKey, modelAKey, modelBKey] = generateOrderKeySequence(4)
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'provider-a', name: 'Provider A', orderKey: providerAKey },
      { providerId: 'provider-b', name: 'Provider B', orderKey: providerBKey }
    ])

    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('provider-a', 'model-A'),
        providerId: 'provider-a',
        modelId: 'model-A',
        presetModelId: 'model-A',
        name: 'model-A',
        isEnabled: true,
        isHidden: false,
        orderKey: modelAKey
      },
      {
        id: createUniqueModelId('provider-b', 'model-B'),
        providerId: 'provider-b',
        modelId: 'model-B',
        presetModelId: 'model-B',
        name: 'model-B',
        isEnabled: true,
        isHidden: false,
        orderKey: modelBKey
      }
    ])
  })

  it('persists emitted exclusions and omits old thinking-only history on a fresh later request', async () => {
    const topicId = 'thinking-wire-topic'
    const rootId = await seedTopicWithRoot(topicId)
    const user = messageService.create(topicId, {
      parentId: rootId,
      role: 'user',
      status: 'success',
      data: mainText('edited prefix')
    })
    const thought = messageService.create(topicId, {
      parentId: user.id,
      role: 'assistant',
      status: 'paused',
      data: {
        parts: [
          {
            type: 'reasoning',
            text: 'Thinking through the question',
            state: 'done',
            providerMetadata: {
              anthropic: { signature: 'original-prefix-signature' },
              cherry: { startedAt: 1000, thinkingMs: 50 }
            }
          }
        ]
      }
    })
    const next = messageService.create(topicId, {
      parentId: thought.id,
      role: 'user',
      status: 'success',
      data: mainText('next question')
    })
    const answer = messageService.create(topicId, {
      parentId: next.id,
      role: 'assistant',
      status: 'pending',
      data: { parts: [] }
    })
    const modelInfo = makeModel({ id: 'custom::claude-sonnet-5-5', providerId: 'custom' })
    const provider = makeProvider({
      id: 'custom',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic', baseUrl: 'https://test' } }
    })
    const bodies: any[] = []
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
        if (assistants.some((message: any) => message.content.some((part: any) => part.type === 'thinking'))) {
          return Response.json(
            {
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message:
                  'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block".'
              }
            },
            { status: 400 }
          )
        }
        return Response.json({
          id: 'answer',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [{ type: 'text', text: 'Completed.' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 }
        })
      }
    })('claude-sonnet-5-5')
    async function prepare(anchorId: string, messageId: string) {
      const contextProvider = new PersistentChatContextProvider()
      const history = await contextProvider['resolveCompactedHistory'](anchorId, topicId, [modelInfo], undefined, {
        enabled: false
      })
      const request = contextProvider['buildStreamRequest'](
        topicId,
        undefined,
        modelInfo.id,
        history.messages,
        messageId,
        undefined,
        undefined,
        undefined,
        false,
        history.retainedContext,
        history.thinkingRecovery
      )
      const scope = {
        provider,
        model: modelInfo,
        aiSdkProviderId: 'anthropic',
        endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        request,
        contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, enabled: false }
      } as unknown as RequestScope
      const context = { middlewares: [] as LanguageModelMiddleware[] } as AiRequestContext
      for (const plugin of collectFromFeatures(scope, INTERNAL_FEATURES).modelAdapters)
        await plugin.configureContext?.(context)
      const prompt = (await toModelMessages(request.messages ?? [])) as LanguageModelV3CallOptions['prompt']
      return { request, prompt, model: wrapLanguageModel({ model: sdkModel, middleware: context.middlewares! }) }
    }
    const first = await prepare(next.id, answer.id)
    const source = structuredClone(first.prompt)
    const firstOutcome = await Promise.allSettled([first.model.doGenerate({ prompt: first.prompt })])
    expect.soft(bodies).toHaveLength(2)
    expect(bodies[0].messages[1].content).toEqual([
      { type: 'thinking', thinking: 'Thinking through the question', signature: 'original-prefix-signature' }
    ])
    const emitted = first.request.anthropicThinkingRecovery!.records
    expect(emitted).toEqual([
      {
        endpointKey: JSON.stringify(['custom', 'anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'https://test']),
        identities: ['original-prefix-signature']
      }
    ])
    expect(messageService.getById(answer.id)?.data.anthropicThinkingRecovery).toEqual(emitted)
    messageService.finalizeAssistantMessage(answer.id, { status: 'success', data: mainText('Completed.') })
    expect(messageService.getById(answer.id)?.data.anthropicThinkingRecovery).toEqual(emitted)
    const laterUser = messageService.create(topicId, {
      parentId: answer.id,
      role: 'user',
      status: 'success',
      data: mainText('later question')
    })
    const laterAnswer = messageService.create(topicId, {
      parentId: laterUser.id,
      role: 'assistant',
      status: 'pending',
      data: { parts: [] }
    })
    const later = await prepare(laterUser.id, laterAnswer.id)
    expect(later.request).not.toBe(first.request)
    expect(later.request.anthropicThinkingRecovery?.records).toEqual(emitted)
    expect(later.request.messages?.some((message) => message.id === thought.id)).toBe(true)
    const attemptsBeforeLater = bodies.length
    const laterOutcome = await Promise.allSettled([later.model.doGenerate({ prompt: later.prompt })])
    expect(bodies.length - attemptsBeforeLater).toBe(1)
    expect(JSON.stringify(bodies[attemptsBeforeLater])).not.toContain('original-prefix-signature')
    expect
      .soft(firstOutcome[0])
      .toMatchObject({ status: 'fulfilled', value: { content: [{ type: 'text', text: 'Completed.' }] } })
    expect
      .soft(laterOutcome[0])
      .toMatchObject({ status: 'fulfilled', value: { content: [{ type: 'text', text: 'Completed.' }] } })
    expect(bodies).toHaveLength(3)
    expect.soft(bodies[1].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'edited prefix' },
          { type: 'text', text: 'next question' }
        ]
      }
    ])
    expect.soft(bodies[2].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'edited prefix' },
          { type: 'text', text: 'next question' }
        ]
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Completed.' }] },
      { role: 'user', content: [{ type: 'text', text: 'later question' }] }
    ])
    expect(messageService.getById(laterAnswer.id)?.data.anthropicThinkingRecovery).toBeUndefined()
    expect(first.prompt).toEqual(source)
    expect(messageService.getById(thought.id)?.data).toEqual(thought.data)
  })

  async function seedTopicWithRoot(topicId: string) {
    await dbh.db.insert(topicTable).values({ id: topicId, activeNodeId: null, orderKey: 'a0' })
    return messageService.createRootMessageTx(dbh.db, topicId)
  }
})
