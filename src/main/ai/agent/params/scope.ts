/**
 * Per-request read-only scope shared by every step that builds the final
 * AgentLoopParams. Constructed once per `streamText` / `generateText` call
 * and threaded through `RequestFeature` contributions and the Phase 2
 * finalize helpers.
 *
 * `ToolApplyScope` lives in `tools/types.ts` so the tool layer can reference
 * it without importing from `agentParams/`. We re-export here for callers
 * that already pull from `agentParams/`.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { StringKeys } from '@cherrystudio/ai-core/provider'
import type { EffectiveContextSettings } from '@shared/data/types/contextSettings'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { RequestContext } from '../../tools/context'
import type { ToolRegistry } from '../../tools/registry'
import type { ToolApplyScope } from '../../tools/types'
import type { AppProviderSettingsMap } from '../../types'
import type { AiBaseRequest } from '../../types/requests'
import type { ResolvedCapabilities } from './capabilities'

export type { ToolApplyScope }

export type AppProviderKey = StringKeys<AppProviderSettingsMap>

export interface SdkConfig<T extends AppProviderKey = AppProviderKey> {
  readonly providerId: T
  readonly providerSettings: AppProviderSettingsMap[T]
  readonly modelId: string
}

export interface RequestScope extends ToolApplyScope {
  readonly request: AiBaseRequest & { chatId?: string }
  readonly signal: AbortSignal | undefined
  readonly registry: ToolRegistry
  readonly model: Model
  readonly provider: Provider
  readonly capabilities: ResolvedCapabilities | undefined
  readonly sdkConfig: SdkConfig
  readonly requestContext: RequestContext
  /**
   * Topic-bound workspace path resolved at request build time. Read by
   * features that need fs context (e.g. static reminder injection).
   * `null` for chats not bound to a folder.
   */
  readonly workspaceRoot: string | null
  /**
   * Fully resolved context-chef settings for THIS request. Collapsed
   * from globals (`chat.context_settings.*` prefs) <- assistant
   * override <- topic override, with `compress.modelId` further
   * resolved through the explicit -> topic-naming-model fallback chain
   * by `resolveContextSettings()`. Always present (helper guarantees a
   * fully-set object even when no overrides exist).
   */
  readonly contextSettings: EffectiveContextSettings
  /**
   * Pre-resolved `LanguageModelV3` for context-build's history
   * compression. Populated by `buildAgentParams` when
   * `contextSettings.compress.enabled === true` AND
   * `contextSettings.compress.modelId` resolves successfully via the
   * same path the agent uses (`createExecutor.languageModel`).
   * `null` when compression is disabled or resolution fails — chef
   * then falls back to its `onBeforeCompress` sliding-window drop.
   */
  readonly compressionModel: LanguageModelV3 | null
}
