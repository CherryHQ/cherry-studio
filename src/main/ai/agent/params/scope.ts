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

import type { StringKeys } from '@cherrystudio/ai-core/provider'
import type { EndpointType, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { RequestContext } from '../../tools/context'
import type { ToolRegistry } from '../../tools/registry'
import type { ToolApplyScope } from '../../tools/types'
import type { AppProviderId, AppProviderSettingsMap } from '../../types'
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
  readonly endpointType: EndpointType | undefined
  readonly aiSdkProviderId: AppProviderId
  readonly requestContext: RequestContext
}
