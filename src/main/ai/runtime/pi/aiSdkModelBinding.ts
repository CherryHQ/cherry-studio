import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { type ExtensionFactory, ModelRuntime } from '@earendil-works/pi-coding-agent'

import { setSessionRequirements } from '@cherrystudio/agent-runtime-pi'

import { type AiSdkModelSpec, type AiSdkProviderOptions, createAiSdkProvider } from './aiSdkProvider'

export type AiSdkModel = AiSdkModelSpec & { provider: string }

/**
 * Cherry supplies one AI SDK request per Pi step, including native compaction requests. Every
 * session built on the returned runtime, subagents' included, gets the binding's tool-call guard
 * and runs with Pi's retry off.
 */
export async function createAiSdkModelBinding<TRequestOptions>(
  options: Omit<AiSdkProviderOptions<TRequestOptions>, 'models' | 'onInvalidToolCall'> & { model: AiSdkModel }
) {
  const invalidCalls = new Map<string, Map<string, string>>()
  const guard: ExtensionFactory = (pi) => {
    pi.on('turn_start', (_event, ctx) => {
      invalidCalls.delete(ctx.sessionManager.getSessionId())
    })
    pi.on('tool_call', (event, ctx) => {
      const reason = invalidCalls.get(ctx.sessionManager.getSessionId())?.get(event.toolCallId)
      return reason === undefined ? undefined : { block: true, reason }
    })
    pi.on('session_shutdown', (_event, ctx) => {
      invalidCalls.delete(ctx.sessionManager.getSessionId())
    })
  }
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  const { provider, ...modelSpec } = options.model
  modelRuntime.registerProvider(
    provider,
    createAiSdkProvider({
      ...options,
      models: [modelSpec],
      onInvalidToolCall(call, toolCallId, reason) {
        if (!call.sessionId) return
        const calls = invalidCalls.get(call.sessionId) ?? new Map<string, string>()
        calls.set(toolCallId, reason)
        invalidCalls.set(call.sessionId, calls)
      }
    })
  )
  const model = modelRuntime.getModel(provider, modelSpec.id)
  if (!model) throw new Error(`Model ${provider}/${modelSpec.id} was not registered`)
  setSessionRequirements(modelRuntime, {
    // Ahead of approvals: malformed calls must never reach a host tool handler.
    extensionFactories: [guard],
    // Retries belong to the AI SDK call; Pi's would repeat each failed one.
    settings: { retry: { enabled: false } }
  })
  return { modelRuntime, model }
}
