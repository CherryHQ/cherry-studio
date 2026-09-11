import { application } from '@application'
import { ForkContextFailure } from '@data/services/AgentSessionForkContextService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { forkContextHash } from '@data/services/utils/forkContext'
import type { ForkContextCompatibility } from '@shared/ai/agentSessionForkContext'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { resolveCompressionModel } from '../contextBuild/resolveCompressionModel'
import { resolveContextWindow } from '../contextBuild/resolveContextWindow'
import type { AgentRuntimeConnection } from '../runtime/types'
import { resolveModelTokenDialect } from '../tokens/dialect'
import { getTextTokenizer, imageTokensFor, mediaTokensFor } from '../tokens/profiles'
import type { PrepareForkContextInput } from './prepareForkContext'

export async function resolveForkContextInput(input: {
  sessionId: string
  runtime: string
  modelId: UniqueModelId
  message: AgentSessionMessageEntity
  connection: AgentRuntimeConnection
  signal: AbortSignal
}): Promise<PrepareForkContextInput> {
  const environment = await input.connection.getForkContextEnvironment?.()
  if (!environment) throw new ForkContextFailure({ code: 'configuration', category: 'not_retryable' })
  const key = parseUniqueModelId(input.modelId)
  const model = modelService.getByKey(key.providerId, key.modelId)
  const dialect = resolveModelTokenDialect(providerService.getByProviderId(key.providerId), model)
  const tokenizer = await getTextTokenizer(dialect)
  const window = resolveContextWindow(environment.contextWindow) ?? resolveContextWindow(model.contextWindow)
  if (!window) throw new ForkContextFailure({ code: 'configuration', category: 'not_retryable' })
  const compressorId =
    application.get('PreferenceService').get('chat.context_settings.compress.model_id')?.trim() || input.modelId
  if (!isUniqueModelId(compressorId)) throw new ForkContextFailure({ code: 'configuration', category: 'not_retryable' })
  const compressorKey = parseUniqueModelId(compressorId)
  const compressorModel = modelService.getByKey(compressorKey.providerId, compressorKey.modelId)
  const compatibility: ForkContextCompatibility = {
    runtime: input.runtime,
    schemaVersion: 1,
    sdkVersion: environment.sdkVersion,
    systemPromptHash: forkContextHash(environment.systemPrompt),
    toolsetHash: forkContextHash(environment.tools),
    compressorHash: forkContextHash({ model: compressorModel, strategy: 'fork-bounded-v1' }),
    modelHash: forkContextHash(model)
  }
  const envelope = tokenizer.count(JSON.stringify({ system: environment.systemPrompt, tools: environment.tools }))
  // Opaque native defaults are not a measured prompt: reserve half the window in addition to known content.
  const reserve = environment.opaqueEnvelope ? Math.floor(window / 2) : Math.floor(window * 0.1)
  const output = Math.min(model.maxOutputTokens ?? 8192, Math.floor(window / 4))
  const parts = input.message.data.parts ?? []
  const messageTokens = parts.reduce((total, part) => {
    if (part.type !== 'file') return total + tokenizer.count(JSON.stringify(part))
    if (part.mediaType.startsWith('image/')) return total + imageTokensFor(dialect)
    if (part.mediaType.startsWith('audio/')) return total + mediaTokensFor(dialect, 'audio')
    if (part.mediaType.startsWith('video/')) return total + mediaTokensFor(dialect, 'video')
    // Agent drivers send ordinary files as local-path references, not base64 prompt bytes.
    return total + tokenizer.count(part.filename ?? '') + 1024
  }, 0)
  const budget = Math.floor(
    Math.min(model.maxInputTokens ?? window, window - output) - envelope - reserve - messageTokens - 1024
  )
  return {
    sessionId: input.sessionId,
    compatibility,
    budget,
    signal: input.signal,
    countTokens: tokenizer.count,
    resolveCompressor: () =>
      resolveCompressionModel(compressorId, { id: input.sessionId, topicId: `agent-session:${input.sessionId}` })
  }
}
