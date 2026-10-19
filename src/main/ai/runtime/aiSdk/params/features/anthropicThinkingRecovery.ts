import { APICallError, type LanguageModelV3CallOptions, type LanguageModelV3Message } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import type { AnthropicThinkingRecoveryRecord } from '@shared/data/types/message'

import { resolveEffectiveEndpoint } from '../../../../provider/endpoint'
import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

const BINDING_DIAGNOSTIC =
  /^messages\.\d+\.content\.\d+: Invalid `signature` in `thinking` block\. The block is bound to a different conversation\. Remove the block, or set `thinking\.block_binding\.prefix_mismatch_behavior` to "drop_block"\./

export function isAnthropicThinkingBindingError(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode !== 400) return false
  const matchesEnvelope = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    const envelope = value as { type?: unknown; error?: { type?: unknown; message?: unknown } }
    return (
      envelope.type === 'error' &&
      envelope.error?.type === 'invalid_request_error' &&
      typeof envelope.error.message === 'string' &&
      BINDING_DIAGNOSTIC.test(envelope.error.message.replace(/\s+/g, ' ').trim())
    )
  }
  if (matchesEnvelope(error.data)) return true
  try {
    return matchesEnvelope(JSON.parse(error.responseBody ?? ''))
  } catch {
    return false
  }
}

function identities(part: LanguageModelV3Message['content'][number]): string[] {
  if (typeof part === 'string' || part.type !== 'reasoning') return []
  const options = part.providerOptions?.anthropic
  return [options?.signature, options?.redactedData].filter((value): value is string => typeof value === 'string')
}

export function excludeAnthropicThinking(
  prompt: LanguageModelV3CallOptions['prompt'],
  excluded: ReadonlySet<string>
): LanguageModelV3CallOptions['prompt'] {
  return prompt.flatMap<LanguageModelV3Message>((message) => {
    if (message.role !== 'assistant') return [message]
    const content = message.content.flatMap((part) => {
      if (!identities(part).some((id) => excluded.has(id))) return [part]
      return []
    })
    return content.length ? [{ ...message, content }] : []
  })
}

export function createAnthropicThinkingRecoveryMiddleware(scope: RequestScope): LanguageModelMiddleware {
  const endpoint = resolveEffectiveEndpoint(scope.provider, scope.model)
  const endpointKey = JSON.stringify([
    scope.provider.id,
    scope.aiSdkProviderId,
    endpoint.endpointType,
    endpoint.baseUrl
  ])
  const memory = scope.request.anthropicThinkingRecovery
  const excluded = new Set(
    memory?.records.filter((record) => record.endpointKey === endpointKey).flatMap((r) => r.identities)
  )

  function repair(error: unknown, params: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
    if (
      scope.signal?.aborted ||
      params.abortSignal?.aborted ||
      scope.request.requestOptions?.maxRetries === 0 ||
      !isAnthropicThinkingBindingError(error)
    )
      throw error
    const eligible = params.prompt.flatMap((message) =>
      message.role === 'assistant' ? message.content.flatMap(identities) : []
    )
    if (!eligible.length) throw error
    for (const id of eligible) excluded.add(id)
    const record: AnthropicThinkingRecoveryRecord = { endpointKey, identities: [...excluded] }
    if (memory) {
      memory.record(record)
      memory.records = [...memory.records.filter((item) => item.endpointKey !== endpointKey), record]
    }
    return { ...params, prompt: excludeAnthropicThinking(params.prompt, excluded) }
  }

  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({ ...params, prompt: excludeAnthropicThinking(params.prompt, excluded) }),
    wrapStream: async ({ doStream, params, model }) => {
      try {
        return await doStream()
      } catch (error) {
        return model.doStream(repair(error, params))
      }
    },
    wrapGenerate: async ({ doGenerate, params, model }) => {
      try {
        return await doGenerate()
      } catch (error) {
        return model.doGenerate(repair(error, params))
      }
    }
  }
}

export const anthropicThinkingRecoveryFeature: RequestFeature = {
  name: 'anthropic-thinking-recovery',
  applies: (scope) => ['anthropic', 'azure-anthropic', 'google-vertex-anthropic'].includes(scope.aiSdkProviderId),
  contributeModelAdapters: (scope) => [
    definePlugin({
      name: 'anthropic-thinking-recovery',
      enforce: 'pre',
      configureContext: (context) => {
        context.middlewares = context.middlewares || []
        context.middlewares.push(createAnthropicThinkingRecoveryMiddleware(scope))
      }
    })
  ]
}
