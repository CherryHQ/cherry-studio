import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { isGemini3Model, isGemini4Model } from '@shared/utils/model'

import type { RequestFeature } from '../feature'

const sentinel = 'skip_thought_signature_validator'
const object = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
const realSignature = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value !== sentinel

export function createGeminiThoughtSignatureReplayMiddleware(providerOptionsKey: string): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({
      ...params,
      prompt: params.prompt.map((message) => {
        if (message.role !== 'assistant') return message
        return {
          ...message,
          content: message.content.map((part) => {
            if (part.type !== 'tool-call' || !part.providerOptions) return part
            const options = part.providerOptions
            const canonical = object(options.google)
            const compatible = object(options.openaiCompatible)
            const extra = object(compatible.extra_content)
            const google = object(extra.google)
            const c = canonical.thoughtSignature
            const w = google.thought_signature
            const p = object(options[providerOptionsKey]).thoughtSignature
            if (realSignature(c)) return part
            const removeCanonical = Object.hasOwn(canonical, 'thoughtSignature')
            const signature = realSignature(w) ? w : realSignature(p) ? p : undefined
            const changeWire = signature !== undefined ? signature !== w : Object.hasOwn(google, 'thought_signature')
            if (!removeCanonical && !changeWire) return part
            const nextOptions = { ...options }
            if (removeCanonical) {
              const rest = { ...canonical }
              delete rest.thoughtSignature
              nextOptions.google = rest
            }
            if (changeWire) {
              const rest = { ...google }
              delete rest.thought_signature
              nextOptions.openaiCompatible = {
                ...compatible,
                extra_content: {
                  ...extra,
                  google: signature === undefined ? rest : { ...rest, thought_signature: signature }
                }
              }
            }
            return { ...part, providerOptions: nextOptions }
          })
        }
      })
    })
  }
}

export const geminiThoughtSignatureReplayFeature: RequestFeature = {
  name: 'gemini-thought-signature-replay',
  applies: (scope) =>
    scope.aiSdkProviderId === 'openai-compatible' &&
    scope.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS &&
    (isGemini3Model(scope.model) || isGemini4Model(scope.model)),
  contributeModelAdapters: (scope) => [
    definePlugin({
      name: 'gemini-thought-signature-replay',
      enforce: 'pre',
      configureContext: (context) => {
        context.middlewares = context.middlewares || []
        context.middlewares.push(createGeminiThoughtSignatureReplayMiddleware(scope.sdkConfig.providerOptionsKey))
      }
    })
  ]
}
