import { readFileSync } from 'node:fs'

import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { setupTestDatabase } from '@test-helpers/db'
import { generateText, readUIMessageStream, streamText, type ModelMessage, wrapLanguageModel } from 'ai'
import { expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { toModelMessages } from '../../../../../messages/messageRules'
import { PersistenceListener } from '../../../../../streamManager/listeners/PersistenceListener'
import { MessageServiceBackend } from '../../../../../streamManager/persistence/backends/MessageServiceBackend'
import type { RequestScope } from '../../scope'
import { openrouterReasoningFeature } from '../openrouterReasoning'

setupTestDatabase()
const encryptedReasoningSse = readFileSync(
  new URL('./fixtures/openrouterEncryptedReasoning.sse', import.meta.url),
  'utf8'
)

it.each(['generate', 'stream'])(
  'replays OpenRouter ciphertext from a tool-free %s reply on its original route',
  async (mode) => {
    const detail = { type: 'reasoning.encrypted', id: 'reasoning-1', format: 'anthropic-claude-v1', data: 'ciphertext' }
    const requests: unknown[] = []
    const modelId = 'anthropic/claude-fixture'
    const base = { id: 'response-1', created: 1, model: modelId }
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      const response = { role: 'assistant', content: 'Visible reply', reasoning_details: [detail] }
      if (mode === 'stream' && requests.length === 1) {
        return new Response(encryptedReasoningSse, {
          headers: { 'content-type': 'text/event-stream' }
        })
      }
      return Response.json({
        ...base,
        choices: [{ index: 0, message: response, finish_reason: 'stop' }]
      })
    }
    const originalUrl = 'https://fixture.invalid/api/v1'
    const routeModel = async (baseURL: string, contextOwner?: 'caller') => {
      const context = { middlewares: [] } as unknown as AiRequestContext
      const scope = {
        replayRouteId: baseURL,
        provider: { id: 'openrouter' },
        request: { contextOwner },
        endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        sdkConfig: { providerId: 'openrouter', modelId, providerSettings: { baseURL } }
      } as RequestScope
      for (const plugin of openrouterReasoningFeature.contributeModelAdapters?.(scope) ?? []) {
        await plugin.configureContext?.(context)
      }
      return wrapLanguageModel({
        model: createOpenRouter({ apiKey: 'fixture', baseURL, fetch })(modelId),
        middleware: context.middlewares ?? []
      })
    }
    const first = { model: await routeModel(originalUrl), prompt: 'Question', maxRetries: 0 }
    let messages: ModelMessage[]
    if (mode === 'stream') {
      let reply: CherryUIMessage | undefined
      for await (const message of readUIMessageStream<CherryUIMessage>({
        stream: streamText(first).toUIMessageStream()
      })) {
        reply = message
      }
      if (!reply) throw new Error('Expected an assistant reply')
      const { id: topicId } = topicService.create({})
      const {
        placeholders: [assistant]
      } = messageService.createUserMessageWithPlaceholders({
        topicId,
        userMessage: {
          mode: 'create',
          dto: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Question' }] } }
        },
        placeholders: [{ role: 'assistant', status: 'pending', data: { parts: [] } }]
      })
      const persistence = new PersistenceListener({
        topicId,
        backend: new MessageServiceBackend({ assistantMessageId: assistant.id }),
        onPersistFailed: () => {}
      })
      await persistence.onDone({ status: 'success', finalMessage: reply })
      const reopened = messageService.getById(assistant.id)
      expect(reopened.status).toBe('success')
      expect(reopened.data.parts).toContainEqual(
        expect.objectContaining({
          type: 'reasoning',
          text: '',
          providerMetadata: expect.objectContaining({ openrouter: { reasoning_details: [detail] } })
        })
      )
      messages = await toModelMessages([{ id: reopened.id, role: 'assistant', parts: reopened.data.parts ?? [] }])
    } else {
      const result = await generateText(first)
      messages = result.response.messages
    }
    const otherUrl = 'https://other.invalid/api/v1'
    for (const [baseURL, contextOwner] of [[otherUrl], [originalUrl], [otherUrl, 'caller']] as const) {
      await generateText({
        model: await routeModel(baseURL, contextOwner),
        messages: [{ role: 'user', content: 'Question' }, ...messages, { role: 'user', content: 'Follow-up' }],
        maxRetries: 0
      })
      const body = requests.at(-1)
      expect(body).toMatchObject({
        messages: expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: 'Visible reply' })])
      })
      if (baseURL === originalUrl || contextOwner === 'caller') {
        expect(body).toMatchObject({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', content: 'Visible reply', reasoning_details: [detail] })
          ])
        })
      } else {
        expect(JSON.stringify(body)).not.toContain('reasoning_details')
      }
    }
  }
)
