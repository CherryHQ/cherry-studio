import type { JSONObject, JSONValue, SharedV3ProviderOptions } from '@ai-sdk/provider'
import { isToolUIPart, type LanguageModelMiddleware, type UIMessage } from 'ai'

import { UniqueModelIdSchema } from '@shared/data/types/model'

import type { AssistantPart } from './providerStateReplay'

function geminiSignatures(options: SharedV3ProviderOptions | undefined): Array<[string, string]> {
  const signatures: Array<[string, string]> = []
  for (const [namespace, optionsValue] of Object.entries(options ?? {})) {
    const signature = optionsValue?.thoughtSignature
    if (typeof signature === 'string' && signature.trim()) signatures.push([namespace, signature])
  }
  return signatures
}

function asObject(value: JSONValue | undefined): JSONObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function compatibleContent(options: SharedV3ProviderOptions | undefined) {
  const extraContent = asObject(options?.openaiCompatible?.extra_content)
  return { extraContent, google: asObject(extraContent.google) }
}

export function hasGeminiSignature(options: SharedV3ProviderOptions | undefined): boolean {
  const compatible = compatibleContent(options).google.thought_signature
  return geminiSignatures(options).length > 0 || (typeof compatible === 'string' && compatible.trim().length > 0)
}

export function legacyGeminiHistory(messages: UIMessage[], targetModelId: string): (part: AssistantPart) => boolean {
  const foreign = new Map<string, boolean>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const metadata = message.metadata
    const source = UniqueModelIdSchema.safeParse(
      metadata && typeof metadata === 'object' && 'modelId' in metadata ? metadata.modelId : undefined
    )
    const isForeign = source.success && source.data !== targetModelId
    for (const part of message.parts) {
      if (isToolUIPart(part)) {
        const key = `tool:${part.toolCallId}`
        // Reused call IDs cannot identify a unique source.
        foreign.set(key, isForeign && !foreign.has(key))
      } else if (part.type === 'text') {
        for (const [, signature] of geminiSignatures(part.providerMetadata)) {
          const key = `text:${signature}`
          foreign.set(key, isForeign && foreign.get(key) !== false)
        }
      }
    }
  }
  return (part) => {
    if (part.type === 'text') {
      return geminiSignatures(part.providerOptions).some(([, signature]) => foreign.get(`text:${signature}`))
    }
    return part.type === 'tool-call' && foreign.get(`tool:${part.toolCallId}`) === true
  }
}

export function omitGeminiSignature(part: Exclude<AssistantPart, { type: 'reasoning' }>) {
  if (part.type === 'tool-call' && part.providerExecuted) return part
  const providerOptions = { ...part.providerOptions }
  for (const [key] of geminiSignatures(part.providerOptions)) {
    const options = { ...providerOptions[key] }
    delete options.thoughtSignature
    providerOptions[key] = options
  }
  const { extraContent, google } = compatibleContent(providerOptions)
  if ('thought_signature' in google) {
    const remaining = { ...google }
    delete remaining.thought_signature
    const extra = { ...extraContent }
    if (Object.keys(remaining).length) extra.google = remaining
    else delete extra.google
    const compatible = { ...providerOptions.openaiCompatible }
    if (Object.keys(extra).length) compatible.extra_content = extra
    else delete compatible.extra_content
    providerOptions.openaiCompatible = compatible
  }
  if (part.type === 'tool-call') {
    providerOptions.cherry = { ...providerOptions.cherry, omitGeminiThoughtSignature: true }
  }
  return { ...part, providerOptions }
}

export const geminiCompatibleToolSignatures: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  transformParams: async ({ params }) => ({
    ...params,
    prompt: params.prompt.map((message) => {
      if (message.role !== 'assistant') return message
      let hasSignedCall = false
      let batchEnd = 0
      let omitBatch = false
      return {
        ...message,
        content: message.content.map((part, index) => {
          if (part.type !== 'tool-call' || part.providerExecuted) return part
          if (index >= batchEnd) {
            omitBatch = false
            for (batchEnd = index; batchEnd < message.content.length; batchEnd++) {
              const call = message.content[batchEnd]
              if (call.type !== 'tool-call' || call.providerExecuted) break
              omitBatch ||= call.providerOptions?.cherry?.omitGeminiThoughtSignature === true
            }
          }
          if (omitBatch) return omitGeminiSignature(part)
          const options = part.providerOptions
          const recorded = geminiSignatures(options)[0]?.[1]
          const { extraContent, google } = compatibleContent(options)
          const nested =
            typeof google.thought_signature === 'string' && google.thought_signature.trim()
              ? google.thought_signature
              : undefined
          if (!recorded && !nested && hasSignedCall) return part
          hasSignedCall ||= Boolean(recorded || nested)
          return {
            ...part,
            providerOptions: {
              ...options,
              ...(recorded && { google: { ...options?.google, thoughtSignature: recorded } }),
              openaiCompatible: {
                ...options?.openaiCompatible,
                extra_content: {
                  ...extraContent,
                  google: { ...google, thought_signature: nested ?? recorded ?? 'skip_thought_signature_validator' }
                }
              }
            }
          }
        })
      }
    })
  })
}
