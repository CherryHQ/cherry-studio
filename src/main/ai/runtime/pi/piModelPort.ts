import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { LanguageModelUsage, ModelMessage, TextStreamPart, ToolSet } from 'ai'

import { application } from '@application'
import { streamText } from '@cherrystudio/ai-core'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { createAiUsagePlugin } from '@main/ai/hooks/billingHook'
import { startAgentRuntimeChildSpan, endAgentRuntimeSpan } from '@main/ai/observability'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { buildAgentParams, readRetryPolicy } from '@main/ai/runtime/aiSdk'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { parseUniqueModelId } from '@shared/data/types/model'
import { ENDPOINT_TYPE, MODEL_CAPABILITY, MODALITY } from '@shared/data/types/model'
import { matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { resolveAgentContextWindow } from '../agentContextWindow'
import type { AgentRuntimeConnectInput } from '../types'
import { createAiSdkModelBinding } from './aiSdkModelBinding'
import type { ModelCallSideChannel } from './aiSdkTypes'
import type { PiConnectionSnapshot } from './piConnectionSignature'

const logger = loggerService.withContext('PiModelPort')

/** Restores the signature CherryIN requires on tool-only Anthropic replies. */
export function restorePiThinkingReplay(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant' || typeof message.content === 'string') return message
    const responseId = message.providerOptions?.cherryPi?.responseId
    if (
      !message.content.some((part) => part.type === 'tool-call') ||
      message.content.some((part) => part.type === 'reasoning')
    )
      return message
    if (typeof responseId !== 'string') return message
    return {
      ...message,
      content: [
        {
          type: 'reasoning',
          text: '\u200B',
          providerOptions: { anthropic: { signature: responseId.replace(/^msg_/, '') } }
        },
        ...message.content
      ]
    }
  })
}

export function createPiModelBinding(
  input: AgentRuntimeConnectInput,
  snapshot: Pick<PiConnectionSnapshot, 'model' | 'provider'>,
  sideChannel: ModelCallSideChannel,
  onUsage: (usage: LanguageModelUsage) => void
) {
  const { model, provider } = snapshot
  return createAiSdkModelBinding({
    model: {
      id: model.id,
      name: model.name,
      contextWindow: resolveAgentContextWindow(model),
      maxTokens: model.maxOutputTokens ?? 8_192,
      reasoning: model.capabilities.includes(MODEL_CAPABILITY.REASONING) || model.reasoning !== undefined,
      input:
        model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION) ||
        model.inputModalities?.includes(MODALITY.IMAGE)
          ? ['text', 'image']
          : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    },
    requestOptions: undefined,
    sideChannel,
    port: {
      async streamText(call) {
        const attribution = application.get('AgentSessionRuntimeService').getActiveUsageContext(input.sessionId)
        const { sdkConfig, credentialReceipt, plugins, options } = await buildAgentParams({
          provider,
          model,
          signal: call.abortSignal,
          request: {
            uniqueModelId: model.id,
            conversation: { id: input.sessionId, topicId: `agent-session:${input.sessionId}` },
            contextOwner: 'caller',
            disableTools: true,
            system: call.system ?? '',
            reasoningEffort: input.reasoningEffort,
            serviceTier: input.serviceTier,
            fastMode: input.fastMode,
            callOverrides: { maxOutputTokens: call.maxOutputTokens, temperature: call.temperature }
          }
        })
        const latestPricing = () => {
          try {
            const currentProvider = providerService.getByProviderId(provider.id)
            const currentModel = modelService.getByKey(provider.id, parseUniqueModelId(model.id).modelId)
            return createAiUsageCaptureContext({
              providerId: provider.id,
              modelId: sdkConfig.modelId,
              pricing: currentModel.pricing,
              billing: currentProvider.settings.billing
            }).pricingSnapshot
          } catch (error) {
            logger.warn('Could not capture invocation pricing', { error })
            return null
          }
        }
        const usage = () =>
          createAiUsageCaptureContext({
            providerId: provider.id,
            providerName: provider.name,
            modelId: sdkConfig.modelId,
            modelName: model.name,
            pricingSnapshot: latestPricing(),
            trustProviderReportedCost: provider.reportsActualCost,
            reportedCostCurrency: provider.reportedCostCurrency,
            credentialReceipt,
            source: attribution?.source ?? null,
            messageRef: attribution ? { kind: 'agent-session', id: attribution.assistantMessageId } : null
          })
        const retry = readRetryPolicy()
        const cherryThinking =
          matchesPreset(provider, SystemProviderIds.cherryin) &&
          resolveEffectiveEndpoint(provider, model).endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
        const span = startAgentRuntimeChildSpan(input.trace, 'pi.generate_content', SpanKind.CLIENT, {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': provider.id,
          'gen_ai.request.model': sdkConfig.modelId
        })
        let ended = false
        const end = (error?: unknown) => {
          if (ended || !span) return
          ended = true
          endAgentRuntimeSpan(
            span,
            error ? { code: SpanStatusCode.ERROR, message: String(error) } : { code: SpanStatusCode.OK },
            error instanceof Error ? error : undefined
          )
        }
        let reader: ReadableStreamDefaultReader<TextStreamPart<ToolSet>>
        try {
          const result = await streamText<AppProviderSettingsMap>(
            sdkConfig.providerId,
            sdkConfig.providerSettings,
            {
              model: sdkConfig.modelId,
              system: call.system,
              messages: cherryThinking ? restorePiThinkingReplay(call.messages) : call.messages,
              tools: call.tools,
              toolChoice: call.toolChoice,
              maxOutputTokens: options.maxOutputTokens ?? call.maxOutputTokens,
              temperature: options.temperature,
              topP: options.topP,
              topK: options.topK,
              presencePenalty: options.presencePenalty,
              frequencyPenalty: options.frequencyPenalty,
              stopSequences: options.stopSequences,
              seed: options.seed,
              timeout: options.timeout,
              providerOptions: options.providerOptions,
              headers: options.headers,
              abortSignal: call.abortSignal,
              maxRetries: retry.enabled ? retry.maxAttempts - 1 : 0,
              experimental_telemetry: options.telemetry
            },
            [...plugins, createAiUsagePlugin(usage)]
          )
          reader = result.fullStream.getReader()
        } catch (error) {
          end(error)
          throw error
        }
        return {
          fullStream: new ReadableStream<TextStreamPart<ToolSet>>({
            async pull(controller) {
              try {
                const next = await reader.read()
                if (next.done) {
                  end()
                  controller.close()
                  return
                }
                const part = next.value
                if (part.type === 'error') end(part.error)
                if (part.type === 'finish-step') {
                  onUsage(part.usage)
                  span?.setAttribute('gen_ai.usage.input_tokens', part.usage.inputTokens ?? 0)
                  span?.setAttribute('gen_ai.usage.output_tokens', part.usage.outputTokens ?? 0)
                }
                controller.enqueue(part)
              } catch (error) {
                end(error)
                controller.error(error)
              }
            },
            async cancel(reason) {
              end(reason ?? new Error('Model call cancelled'))
              await reader.cancel(reason)
            }
          })
        }
      }
    }
  })
}
