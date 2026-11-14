import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Prompt } from '@ai-sdk/provider'
import { APICallError, wrapLanguageModel } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { PluginEngine, definePlugin } from '@cherrystudio/ai-core'

import { makeModel, makeProvider } from '../../../../../__tests__/fixtures'
import { OllamaPromptExceedsContextError } from '../../../../../messages/attachmentBudget'
import { createRetryableWrap } from '../../../retry/createRetryableWrap'
import type { RequestScope } from '../../scope'
import { INTERNAL_FEATURES } from '../internalFeatures'
import { ollamaCapacityGuardFeature } from '../ollamaCapacityGuard'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: vi.fn() } }))
vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: vi.fn() } }))
/** One token per character keeps the arithmetic readable. */
vi.mock('@main/ai/tokens/profiles', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTextTokenizer: async () => ({ id: 'chars', count: (text: string) => text.length })
}))

const snapshot = { uniqueModelId: 'ollama::qwen', trainedContextWindow: 32_768, numCtx: 4_096 }
const provider = makeProvider({ id: 'ollama' })
const model = makeModel({ id: 'ollama::qwen', providerId: 'ollama', contextWindow: 32_768 })

const scopeOf = (ollamaNumCtx: typeof snapshot | undefined) =>
  ({
    provider,
    model,
    endpointType: undefined,
    sdkConfig: { providerId: 'ollama' },
    requestContext: { ollamaNumCtx }
  }) as unknown as RequestScope

const textPrompt = (chars: number): LanguageModelV3Prompt => [
  { role: 'user', content: [{ type: 'text', text: 'x'.repeat(chars) }] }
]
const callOf = (chars: number, extra: Partial<LanguageModelV3CallOptions> = {}): LanguageModelV3CallOptions => ({
  prompt: textPrompt(chars),
  ...extra
})

/** Mirrors what the plugin engine does: configureContext collects middlewares, then they wrap the model. */
async function middlewaresFor(scope: RequestScope, preceding: unknown[] = []) {
  const [plugin] = ollamaCapacityGuardFeature.contributeModelAdapters!(scope)
  const context = { middlewares: [...preceding] } as { middlewares: never[] }
  await plugin.configureContext!(context as never)
  return { plugin, middlewares: context.middlewares }
}

const fakeModel = (doStream: ReturnType<typeof vi.fn>, modelId = 'qwen'): LanguageModelV3 =>
  ({
    specificationVersion: 'v3',
    provider: 'ollama',
    modelId,
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream
  }) as unknown as LanguageModelV3

/** Stand-in for context-build: shrinks an oversized prompt before the model sees it. */
const shrinkingMiddleware = {
  specificationVersion: 'v3' as const,
  transformParams: async ({ params }: { params: LanguageModelV3CallOptions }) => ({
    ...params,
    prompt: textPrompt(100)
  })
}

describe('ollamaCapacityGuardFeature', () => {
  it('applies only to Ollama requests that carry a capped window snapshot', () => {
    expect(ollamaCapacityGuardFeature.applies!(scopeOf(snapshot))).toBe(true)
    expect(ollamaCapacityGuardFeature.applies!(scopeOf(undefined))).toBe(false)
    expect(
      ollamaCapacityGuardFeature.applies!({
        ...scopeOf(snapshot),
        provider: makeProvider({ id: 'openai' }),
        sdkConfig: { providerId: 'openai' }
      } as unknown as RequestScope)
    ).toBe(false)
  })

  it('is registered after context-build, and as a post plugin, so it is the innermost middleware', async () => {
    const names = INTERNAL_FEATURES.map((feature) => feature.name)
    expect(names.indexOf('ollama-capacity-guard')).toBeGreaterThan(names.indexOf('context-build'))
    expect(names.indexOf('ollama-capacity-guard')).toBeGreaterThan(names.indexOf('tool-schema-compatibility'))
    const { plugin } = await middlewaresFor(scopeOf(snapshot))
    expect(plugin.enforce).toBe('post')
  })

  it('prices the prompt AFTER earlier middleware shrinks it (no false reject)', async () => {
    const doStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const { middlewares } = await middlewaresFor(scopeOf(snapshot), [shrinkingMiddleware])
    const wrapped = wrapLanguageModel({ model: fakeModel(doStream), middleware: middlewares })

    await wrapped.doStream(callOf(9_044))

    expect(doStream).toHaveBeenCalledOnce()
    expect(doStream.mock.calls[0][0].prompt).toEqual(textPrompt(100))
  })

  it('real plugin engine: the guard stays innermost even when a later plugin shrinks the prompt', async () => {
    const doStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const [guardPlugin] = ollamaCapacityGuardFeature.contributeModelAdapters!(scopeOf(snapshot))
    const resolver = definePlugin({ name: 'resolver', resolveModel: async () => fakeModel(doStream) })
    const shrinker = definePlugin({
      name: 'shrinker',
      configureContext: (context) => {
        context.middlewares = [...(context.middlewares ?? []), shrinkingMiddleware]
      }
    })
    // Registered guard-first on purpose: only the engine's pre -> normal -> post sort (shrinker is a normal plugin) puts it last.
    const model = await new PluginEngine('ollama' as never, [guardPlugin, resolver, shrinker]).resolveModel('qwen')

    await model.doStream(callOf(9_044))

    expect(doStream).toHaveBeenCalledOnce()
    expect(doStream.mock.calls[0][0].prompt).toEqual(textPrompt(100))
  })

  it('outer placement would reject a call that earlier middleware makes fit (why order matters)', async () => {
    const doStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const { middlewares } = await middlewaresFor(scopeOf(snapshot))
    const outerGuard = wrapLanguageModel({
      model: wrapLanguageModel({ model: fakeModel(doStream), middleware: [shrinkingMiddleware] }),
      middleware: middlewares
    })

    await expect(outerGuard.doStream(callOf(9_044))).rejects.toBeInstanceOf(OllamaPromptExceedsContextError)
    expect(doStream).not.toHaveBeenCalled()
  })

  it('rejects a call that stays oversized after earlier middleware, before the provider runs', async () => {
    const doStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const noShrink = { specificationVersion: 'v3' as const, transformParams: async ({ params }: never) => params }
    const { middlewares } = await middlewaresFor(scopeOf(snapshot), [noShrink])
    const wrapped = wrapLanguageModel({ model: fakeModel(doStream), middleware: middlewares })

    await expect(wrapped.doStream(callOf(9_044))).rejects.toBeInstanceOf(OllamaPromptExceedsContextError)
    expect(doStream).not.toHaveBeenCalled()
  })

  it('uses the num_ctx actually on the wire, and counts the output reservation', async () => {
    const doStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const { middlewares } = await middlewaresFor(scopeOf(snapshot))
    const wrapped = wrapLanguageModel({ model: fakeModel(doStream), middleware: middlewares })
    const wire = (numCtx: number) => ({ ollama: { options: { num_ctx: numCtx } } })

    // Fits the frozen 4,096 snapshot but not a smaller user-set wire window.
    await expect(wrapped.doStream(callOf(2_000, { providerOptions: wire(2_048) }))).rejects.toBeInstanceOf(
      OllamaPromptExceedsContextError
    )
    await expect(wrapped.doStream(callOf(1_000, { maxOutputTokens: 3_800 }))).rejects.toBeInstanceOf(
      OllamaPromptExceedsContextError
    )
    await wrapped.doStream(callOf(1_000))
    expect(doStream).toHaveBeenCalledOnce()
  })

  it('leaves an uncapped window alone', async () => {
    const doStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const { middlewares } = await middlewaresFor(scopeOf({ ...snapshot, numCtx: 32_768 }))
    await wrapLanguageModel({ model: fakeModel(doStream), middleware: middlewares }).doStream(callOf(9_044))
    expect(doStream).toHaveBeenCalledOnce()
  })

  it('keeps configured failover: the fallback still runs after a guard rejection', async () => {
    const primaryStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const fallbackStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const { middlewares } = await middlewaresFor(scopeOf(snapshot))
    const wrap = createRetryableWrap({
      fallbacks: [async () => ({ model: fakeModel(fallbackStream, 'big'), canDispatch: async () => true })],
      retryPolicy: { enabled: true, maxAttempts: 1, backoffEnabled: false, fallbackModelIds: ['other::big'] }
    })!

    await wrap(wrapLanguageModel({ model: fakeModel(primaryStream), middleware: middlewares })).doStream(callOf(9_044))

    expect(primaryStream).not.toHaveBeenCalled()
    expect(fallbackStream).toHaveBeenCalledOnce()
  })

  it('guards a later tool-loop call served by a cached API-key model', async () => {
    const keyStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() })
    const primaryStream = vi
      .fn()
      .mockRejectedValue(
        new APICallError({ message: 'rate limited', url: 'http://x', requestBodyValues: {}, statusCode: 429 })
      )
    // Each buildAgentParams call (primary and key fallback) contributes its own copy of the guard.
    const guarded = async (doStream: ReturnType<typeof vi.fn>) =>
      wrapLanguageModel({
        model: fakeModel(doStream),
        middleware: (await middlewaresFor(scopeOf(snapshot))).middlewares
      })
    const wrap = createRetryableWrap({
      apiKeyFallbacks: [async () => ({ model: await guarded(keyStream) })],
      fallbacks: [],
      retryPolicy: { enabled: false, maxAttempts: 1, backoffEnabled: false, fallbackModelIds: [] }
    })!
    const wrapped = wrap(await guarded(primaryStream))

    await wrapped.doStream(callOf(100)) // step 1 fits; primary 429s; key model serves it
    expect(keyStream).toHaveBeenCalledTimes(1)
    await expect(wrapped.doStream(callOf(9_044))).rejects.toBeInstanceOf(OllamaPromptExceedsContextError)
    expect(keyStream).toHaveBeenCalledTimes(1)
  })
})
