/**
 * Resolve a Cherry-side compression-model selector (`<providerId>::<modelId>`
 * UniqueModelId) into a `LanguageModelV3` via the SAME path the agent uses:
 * Provider+Model rows (DataApi) → `resolveSdkConfig` → `createExecutor`
 * → `executor.languageModel(modelId)`.
 *
 * Returns `null` (never throws) on any failure — the compress feature treats
 * null as "compression off" so a misconfigured model never breaks the chat.
 */
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai'

import { createExecutor } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { isFallbackCallWithinWindow } from '@main/ai/messages/attachmentBudget'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { resolveSdkConfig } from '@main/ai/provider/sdkConfig'
import {
  resolveOllamaRequestNumCtx,
  usesOllamaWirePath,
  writeOllamaWireNumCtx
} from '@main/ai/utils/ollamaRequestNumCtx'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { OllamaNumCtxRequestSnapshot } from '@shared/ai/ollamaNumCtx'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

import type { ConversationRef } from '../types'
import { resolveContextWindow } from './resolveContextWindow'

const logger = loggerService.withContext('resolveCompressionModel')

/**
 * The compression model plus the window its OWN requests must fit.
 *
 * The two windows are genuinely different: chat-history trigger / keep budgets
 * belong to the request model, but the summarize call is issued against the
 * compressor, so its input+output budget must come from the compressor's
 * window. Chatting on a 128k model while compressing with an 8k one used to
 * hand the summarize call a 128k-derived budget and overflow it — durable then
 * fell back to un-compacted history, and in-loop failed the turn.
 *
 * `contextWindow` is `null` when the compressor row declares none.
 */
export interface CompressionModelDescriptor {
  readonly languageModel: LanguageModelV3
  readonly contextWindow: number | null
}

export async function resolveCompressionModel(
  modelIdRaw: string,
  conversation: ConversationRef
): Promise<CompressionModelDescriptor | null> {
  if (!modelIdRaw || !isUniqueModelId(modelIdRaw)) {
    logger.warn('compression modelId is not a valid UniqueModelId', { modelIdRaw })
    return null
  }

  const { providerId, modelId } = parseUniqueModelId(modelIdRaw)

  let provider
  let model
  try {
    provider = providerService.getByProviderId(providerId)
    model = modelService.getByKey(providerId, modelId)
  } catch (error) {
    logger.warn('compression provider/model lookup failed', {
      providerId,
      modelId,
      error: (error as Error).message
    })
    return null
  }

  try {
    const endpoint = resolveEffectiveEndpoint(provider, model)
    const { sdkConfig } = await resolveSdkConfig(provider, model, endpoint)
    const resolution = usesOllamaWirePath(provider, endpoint.endpointType, sdkConfig.providerId)
      ? resolveOllamaRequestNumCtx(model, provider, endpoint.endpointType)
      : undefined
    const ollamaNumCtx: OllamaNumCtxRequestSnapshot | undefined = resolution
      ? { uniqueModelId: model.id, trainedContextWindow: resolution.trainedContextWindow, numCtx: resolution.numCtx }
      : undefined
    // App provider extensions are registered beyond the executor's built-in type union.
    const executor = await createExecutor(
      sdkConfig.providerId as Parameters<typeof createExecutor>[0],
      sdkConfig.providerSettings as Parameters<typeof createExecutor>[1]
    )
    const resolvedModel = await executor.languageModel(sdkConfig.modelId)
    // Both compaction consumers share this model. Freeze its OWN window and
    // validate the final summary prompt before any incomplete result can replace
    // the folded history. Do not re-sample memory between budgeting and dispatch.
    const languageModel = ollamaNumCtx
      ? wrapLanguageModel({
          model: resolvedModel,
          middleware: {
            specificationVersion: 'v3',
            transformParams: async ({ params }) => {
              if (
                !(await isFallbackCallWithinWindow({
                  call: params,
                  fallbackProvider: provider,
                  fallbackModel: model,
                  fallbackEndpointType: endpoint.endpointType,
                  fallbackRuntimeProviderId: sdkConfig.providerId,
                  fallbackOllamaNumCtx: ollamaNumCtx
                }))
              ) {
                throw new Error(
                  'The summary prompt and output reservation exceed the Ollama compression context window. History was not folded.'
                )
              }
              return {
                ...params,
                providerOptions: writeOllamaWireNumCtx(params.providerOptions ?? {}, ollamaNumCtx.numCtx)
              }
            }
          }
        })
      : resolvedModel
    return {
      languageModel: sdkConfig.conversationHeader
        ? wrapLanguageModel({
            model: languageModel,
            middleware: defaultSettingsMiddleware({
              settings: { headers: { [sdkConfig.conversationHeader]: conversation.id } }
            })
          })
        : languageModel,
      contextWindow: resolveContextWindow(ollamaNumCtx?.numCtx ?? model.contextWindow)
    }
  } catch (error) {
    logger.warn('compression model resolution failed', {
      providerId,
      modelId,
      error: (error as Error).message
    })
    return null
  }
}
