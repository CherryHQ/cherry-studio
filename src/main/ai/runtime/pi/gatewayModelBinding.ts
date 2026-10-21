import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { resolveApiGatewayRuntime } from '../agentApiGateway'
import { buildPiGatewayInjection, materializePiProviderStream } from './modelInjection'
import { loadPiAi, loadPiSdk } from './piSdk'

/** Native Pi protocols target Cherry's internal gateway; Cherry retains provider credentials and billing. */
export async function createPiGatewayModelBinding(sessionId: string, provider: Provider, model: Model) {
  const injection = buildPiGatewayInjection(provider, model, await resolveApiGatewayRuntime(sessionId))
  const [{ InMemoryCredentialStore }, { ModelRuntime }, native] = await Promise.all([
    loadPiAi(),
    loadPiSdk(),
    materializePiProviderStream(injection)
  ])
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  modelRuntime.registerProvider(injection.providerName, {
    ...native.providerConfig,
    // Pi's session retry policy owns retries; neither gateway nor HTTP client retries a step.
    streamSimple: (model, context, options) => native.streamSimple(model, context, { ...options, maxRetries: 0 })
  })
  await modelRuntime.setRuntimeApiKey(injection.providerName, injection.apiKey)
  const registered = modelRuntime.getModel(injection.providerName, injection.modelId)
  if (!registered) throw new Error(`Pi gateway model ${injection.modelId} was not registered`)
  return { modelRuntime, model: registered }
}
