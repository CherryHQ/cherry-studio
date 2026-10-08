import { definePlugin } from '@cherrystudio/ai-core'
import { projectRuntimeReasoning } from '@data/services/ProviderRegistryService'

import type { RequestFeature } from '../feature'
import { createReasoningMiddleware, type ReasoningControl } from '../reasoningControl'
import type { RequestScope } from '../scope'

export function createRequestReasoningControl(scope: RequestScope): ReasoningControl {
  return {
    model: scope.reasoningProfile.support
      ? {
          ...scope.model,
          reasoning: projectRuntimeReasoning(scope.reasoningProfile.support, scope.reasoningProfile.wire)
        }
      : scope.model,
    profile: scope.reasoningProfile.wire,
    providerId: scope.sdkConfig.providerId,
    providerOptionsKey: scope.sdkConfig.providerOptionsKey,
    endpointType: scope.endpointType,
    enabled: scope.capabilities?.enableReasoning ?? scope.request.reasoningEffort !== undefined,
    selection: scope.request.reasoningEffort ?? scope.assistant?.settings.reasoning_effort ?? 'default',
    summary: scope.assistant?.settings.reasoning_summary
  }
}

export const reasoningControlFeature: RequestFeature = {
  name: 'reasoning-control',
  contributeModelAdapters: (scope) => [
    definePlugin({
      name: 'reasoning-control',
      configureContext: (context) => {
        context.middlewares ??= []
        context.middlewares.push(createReasoningMiddleware(createRequestReasoningControl(scope)))
      }
    })
  ]
}
