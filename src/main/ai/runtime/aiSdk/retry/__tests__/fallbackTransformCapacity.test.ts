import type { LanguageModelV3 } from '@ai-sdk/provider'
import { APICallError } from 'ai'
import { describe, it, expect, vi } from 'vitest'

import { PluginEngine, definePlugin, createContextMiddleware } from '@cherrystudio/ai-core'
import type { AiPlugin } from '@cherrystudio/ai-core'
import type * as AiCore from '@cherrystudio/ai-core'

import { makeModel, makeProvider } from '../../../../__tests__/fixtures'
import type { buildAgentParams } from '../../params/buildAgentParams'
import { buildFallbackModels } from '../buildFallbackModels'
import { createRetryableWrap } from '../createRetryableWrap'
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: () =>
      makeProvider({
        id: 'ollama',
        defaultChatEndpoint: 'ollama-chat',
        endpointConfigs: { 'ollama-chat': { baseUrl: 'http://localhost:11434', adapterFamily: 'ollama' } }
      })
  }
}))
vi.mock('@main/data/services/ModelService', () => ({
  modelService: {
    getByKey: () => makeModel({ id: 'ollama::fallback', providerId: 'ollama', contextWindow: 4096 })
  }
}))
const built = vi.hoisted(() => ({ current: null as Awaited<ReturnType<typeof buildAgentParams>> | null }))
vi.mock('../../params/buildAgentParams', () => ({ buildAgentParams: async () => built.current }))
vi.mock('@cherrystudio/ai-core', async (importOriginal) => ({
  ...(await importOriginal<typeof AiCore>()),
  resolveLanguageModel: async (_p: unknown, _s: unknown, id: string, plugins: AiPlugin[]) =>
    new PluginEngine('ollama' as never, plugins).resolveModel(id)
}))
const ok = {
  content: [],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: { inputTokens: 1, outputTokens: 0 },
  warnings: []
}
const model = (id: string, generate: ReturnType<typeof vi.fn>): LanguageModelV3 =>
  ({
    specificationVersion: 'v3',
    provider: 'test',
    modelId: id,
    supportedUrls: {},
    doGenerate: generate,
    doStream: generate
  }) as unknown as LanguageModelV3
describe('transformed fallback capacity', () => {
  for (const method of ['doGenerate', 'doStream'] as const)
    it(`${method} runs fallback middleware before the final guard`, async () => {
      const run = vi.fn().mockResolvedValue(ok)
      const contextMiddleware = createContextMiddleware({ truncate: { threshold: 1000, headChars: 50, tailChars: 50 } })
      const shrink = vi.fn(contextMiddleware.transformParams)
      built.current = {
        sdkConfig: { providerId: 'ollama', providerSettings: {}, modelId: 'fallback', providerOptionsKey: 'ollama' },
        credentialReceipt: { attribution: 'unknown' },
        tools: undefined,
        system: undefined,
        fileAttachments: [],
        options: {},
        nativeFileSupport: { image: false, pdf: false, audio: false, video: false },
        hookParts: [],
        plugins: [
          definePlugin({ name: 'resolve', resolveModel: () => model('fallback', run) }),
          definePlugin({
            name: 'shrink',
            configureContext: (context) => {
              context.middlewares = [{ specificationVersion: 'v3', transformParams: shrink }]
            }
          })
        ]
      }
      const fallbacks = buildFallbackModels({
        request: { messages: [] } as never,
        assistant: undefined,
        signal: undefined,
        primaryUniqueModelId: 'openai::primary',
        primaryHasTools: false,
        requiredNativeFileSupport: { image: false, pdf: false, audio: false, video: false },
        extraFeatures: [],
        retryPolicy: { enabled: true, maxAttempts: 1, backoffEnabled: false, fallbackModelIds: ['ollama::fallback'] },
        createUsagePlugin: () => definePlugin({ name: 'usage' })
      })
      const wrap = createRetryableWrap({
        retryPolicy: { enabled: true, maxAttempts: 1, backoffEnabled: false, fallbackModelIds: [] },
        fallbacks
      })!
      const wrapped = wrap(
        model(
          'primary',
          vi
            .fn()
            .mockRejectedValue(
              new APICallError({ message: 'auth', statusCode: 401, url: 'https://x', requestBodyValues: {} })
            )
        )
      )
      await wrapped[method]({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'fetch' }] },
          { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'fetch', input: {} }] },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'c1',
                toolName: 'fetch',
                output: { type: 'text', value: 'word '.repeat(10000) }
              }
            ]
          }
        ]
      })
      expect(shrink).toHaveBeenCalledOnce()
      expect(run).toHaveBeenCalledOnce()
      expect(JSON.stringify(run.mock.calls[0][0].prompt).length).toBeLessThan(4096)
      // Each later operation goes through the same transformed-capacity guard.
      await expect(
        wrapped[method]({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'cannot trim '.repeat(3000) }] }] })
      ).rejects.toThrow('Fallback prompt exceeds')
      expect(run).toHaveBeenCalledOnce()
      expect(shrink).toHaveBeenCalledTimes(2)
      // The rejected transformed candidate must not block a later fitting fallback.
      const secondRun = vi.fn().mockResolvedValue(ok)
      const progressed = createRetryableWrap({
        retryPolicy: { enabled: true, maxAttempts: 1, backoffEnabled: false, fallbackModelIds: [] },
        fallbacks: [...fallbacks, async () => ({ model: model('second', secondRun) })]
      })!(model('primary', vi.fn().mockRejectedValue(new Error('primary'))))
      await progressed[method]({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'cannot trim '.repeat(3000) }] }]
      })
      expect(secondRun).toHaveBeenCalledOnce()
      expect(run).toHaveBeenCalledOnce()
    })
})
