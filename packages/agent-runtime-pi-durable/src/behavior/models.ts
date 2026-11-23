import { createAssistantMessageEventStream, type AssistantMessage, type Models } from '@earendil-works/pi-ai'

import type { PiDurableBehavior } from './harness'

/** The native provider session identifies the conversation; metering happens before the provider is called. */
export function meteredModels(models: Models, behavior: PiDurableBehavior): Models {
  const streamSimple: Models['streamSimple'] = (model, messages, options) => {
    if (options?.readOnlyFork) return models.streamSimple(model, messages, options)
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

  return {
    getProviders: models.getProviders.bind(models),
    getProvider: models.getProvider.bind(models),
    getModels: models.getModels.bind(models),
    getModel: models.getModel.bind(models),
    getModelsOfType: models.getModelsOfType.bind(models),
    getModelOfType: models.getModelOfType.bind(models),
    getAllModels: models.getAllModels.bind(models),
    refresh: models.refresh.bind(models),
    checkAuth: models.checkAuth.bind(models),
    getAvailable: models.getAvailable.bind(models),
    getAvailableOfType: models.getAvailableOfType.bind(models),
    getAllAvailable: models.getAllAvailable.bind(models),
    getAuth: models.getAuth.bind(models),
    login: models.login.bind(models),
    logout: models.logout.bind(models),
    stream: models.stream.bind(models),
    complete: models.complete.bind(models),
    completeSimple: models.completeSimple.bind(models),
    streamDeferred: models.streamDeferred.bind(models),
    fetchDeferred: models.fetchDeferred.bind(models),
    cancelDeferred: models.cancelDeferred.bind(models),
    generateImages: models.generateImages.bind(models),
    classify: models.classify.bind(models),
    streamSimple
  }
}
