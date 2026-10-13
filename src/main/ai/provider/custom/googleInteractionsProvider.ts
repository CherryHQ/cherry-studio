import { createGoogleGenerativeAI, type GoogleGenerativeAIProviderSettings } from '@ai-sdk/google'
import type { LanguageModelV3, LanguageModelV3CallOptions, SharedV3ProviderMetadata } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import * as z from 'zod'

const interactionStateSchema = z.object({
  id: z.string().optional(),
  environment_id: z.string().optional()
})

const interactionEventSchema = z.object({ interaction: interactionStateSchema.optional() })

function previousAgentState(prompt: LanguageModelV3CallOptions['prompt'], modelId: string, baseURL: string) {
  const index = prompt.findLastIndex((message) => message.role === 'assistant')
  const assistant = prompt[index]
  if (!assistant || assistant.role !== 'assistant') return undefined
  for (const part of assistant.content.toReversed()) {
    const state = part.providerOptions?.google
    if (state?.agentModelId === modelId && state?.agentBaseURL === baseURL) return { state, index }
  }
  return undefined
}

function withAgentState<T extends { providerMetadata?: SharedV3ProviderMetadata }>(
  part: T,
  state: SharedV3ProviderMetadata['google']
): T {
  return {
    ...part,
    providerMetadata: {
      ...part.providerMetadata,
      google: { ...part.providerMetadata?.google, ...state }
    }
  }
}

function antigravityModel(model: LanguageModelV3, baseURL: string): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      overrideSupportedUrls: () => ({}),
      transformParams: async ({ params }) => {
        const previous = previousAgentState(params.prompt, model.modelId, baseURL)
        const google = params.providerOptions?.google
        const canResume =
          previous &&
          typeof previous.state.interactionId === 'string' &&
          previous.state.interactionId.length > 0 &&
          google?.store !== false &&
          (google?.previousInteractionId == null || google.previousInteractionId === previous.state.interactionId)
        return {
          ...params,
          prompt: canResume
            ? params.prompt.filter((message, index) => message.role === 'system' || index > previous.index)
            : params.prompt,
          providerOptions: {
            ...params.providerOptions,
            google: {
              ...google,
              previousInteractionId:
                google?.previousInteractionId ?? (canResume ? previous.state.interactionId : undefined),
              environment: google?.environment ?? (canResume ? previous.state.environmentId : undefined) ?? 'remote'
            }
          }
        }
      },
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate()
        const parsed = interactionStateSchema.safeParse(result.response?.body)
        const state = {
          agentModelId: model.modelId,
          agentBaseURL: baseURL,
          ...(parsed.success && parsed.data.id ? { interactionId: parsed.data.id } : {}),
          ...(parsed.success && parsed.data.environment_id ? { environmentId: parsed.data.environment_id } : {})
        }
        return {
          ...withAgentState(result, state),
          content: result.content.map((part) => withAgentState(part, state))
        }
      },
      wrapStream: async ({ params, doStream }) => {
        const includeRawChunks = params.includeRawChunks
        params.includeRawChunks = true
        const result = await doStream()
        const state: SharedV3ProviderMetadata['google'] = {
          agentModelId: model.modelId,
          agentBaseURL: baseURL
        }
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                if (chunk.type === 'raw') {
                  const parsed = interactionEventSchema.safeParse(chunk.rawValue)
                  if (parsed.success && parsed.data.interaction) {
                    const interaction = parsed.data.interaction
                    if (interaction.id) state.interactionId = interaction.id
                    if (interaction.environment_id) state.environmentId = interaction.environment_id
                  }
                  if (includeRawChunks) controller.enqueue(chunk)
                  return
                }
                if (
                  chunk.type === 'text-start' ||
                  chunk.type === 'text-delta' ||
                  chunk.type === 'text-end' ||
                  chunk.type === 'reasoning-start' ||
                  chunk.type === 'reasoning-delta' ||
                  chunk.type === 'reasoning-end' ||
                  chunk.type === 'tool-call' ||
                  chunk.type === 'tool-result' ||
                  chunk.type === 'finish'
                ) {
                  controller.enqueue(withAgentState(chunk, state))
                } else {
                  controller.enqueue(chunk)
                }
              }
            })
          )
        }
      }
    }
  })
}

export function createGoogleInteractionsProvider(settings: GoogleGenerativeAIProviderSettings = {}) {
  const google = createGoogleGenerativeAI(settings)
  const baseURL = settings.baseURL ?? 'https://generativelanguage.googleapis.com/v1beta'
  return {
    ...google,
    languageModel: (modelId: string) =>
      modelId.startsWith('antigravity-preview')
        ? antigravityModel(google.interactions({ managedAgent: modelId }), baseURL)
        : google.interactions(modelId)
  }
}
