import { createAssistantMessageEventStream, type AssistantMessage, type Models } from '@earendil-works/pi-ai'

import type { PiDurableBehavior } from './harness'

/** The native provider session identifies the conversation; metering happens before the provider is called. */
export function meteredModels(models: Models, behavior: PiDurableBehavior): Models {
  const streamSimple: Models['streamSimple'] = (model, messages, options) => {
    const output = createAssistantMessageEventStream()
    void (async () => {
      try {
        if (!options?.sessionId) throw new Error('Durable model request has no provider session')
        const thread = await behavior.providerThread(options.sessionId)
        const allowance = await behavior.consumeRequest(thread)
        if (!allowance.ok) throw new Error(`quota exceeded: ${allowance.text}`)
        options.signal?.throwIfAborted()
        const input = models.streamSimple(model, messages, options)
        for await (const event of input) output.push(event)
        output.end(await input.result())
      } catch (cause) {
        const error: AssistantMessage = {
          role: 'assistant',
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          timestamp: Date.now(),
          stopReason: options?.signal?.aborted ? 'aborted' : 'error',
          errorMessage: cause instanceof Error ? cause.message : String(cause)
        }
        output.push({ type: 'error', reason: error.stopReason as 'error' | 'aborted', error })
        output.end(error)
      }
    })()
    return output
  }
  return new Proxy(models, {
    get(target, key, receiver) {
      if (key === 'streamSimple') return streamSimple
      const value = Reflect.get(target, key, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
