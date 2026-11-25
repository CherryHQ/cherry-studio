import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, readUIMessageStream, streamText, type ModelMessage, type UIMessage, wrapLanguageModel } from 'ai'
import { expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { toModelMessages } from '../../../../../messages/messageRules'
import type { RequestScope } from '../../scope'
import { openrouterReasoningFeature } from '../openrouterReasoning'

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
        const chunks = [
          { delta: { reasoning_details: [detail] }, finish_reason: null },
          { delta: { content: response.content }, finish_reason: null },
          { delta: {}, finish_reason: 'stop' }
        ].map((choice) => 'data: ' + JSON.stringify({ ...base, choices: [{ index: 0, ...choice }] }) + '\n\n')
        return new Response(chunks.join('') + 'data: [DONE]\n\n', {
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
      let reply: UIMessage | undefined
      for await (const message of readUIMessageStream({ stream: streamText(first).toUIMessageStream() })) {
        reply = message
      }
      if (!reply) throw new Error('Expected an assistant reply')
      messages = await toModelMessages([JSON.parse(JSON.stringify(reply))])
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
