import { definePlugin } from '@cherrystudio/ai-core'
/**
 * Final-call capacity guard for Ollama requests whose `num_ctx` was capped below the
 * model's window to fit memory (#19864).
 *
 * Compaction and attachment truncation budget against the capped window but cannot
 * shrink a sole latest turn, and Ollama truncates an over-long prompt without an
 * error. This is the innermost middleware (contributed last, `enforce: 'post'`), so it
 * prices the prompt the provider will actually receive, AFTER context-build
 * truncation/compaction and the other prompt rewriters have run. Because every
 * `buildAgentParams` caller (primary, API-key fallbacks, model fallbacks; streaming and
 * non-streaming) gets its own copy, a later call served by a cached key or fallback
 * model is checked too. The error is an ordinary attempt error: retry and fallback
 * policy are unchanged.
 */
import { assertPrimaryOllamaCallWithinWindow } from '@main/ai/messages/attachmentBudget'
import { readOllamaWireNumCtx, usesOllamaWirePath } from '@main/ai/utils/ollamaRequestNumCtx'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

function createOllamaCapacityGuardPlugin(scope: RequestScope) {
  return definePlugin({
    name: 'ollama-capacity-guard',
    enforce: 'post',
    configureContext: (context) => {
      const snapshot = scope.requestContext?.ollamaNumCtx
      if (!snapshot) return
      context.middlewares = context.middlewares || []
      context.middlewares.push({
        specificationVersion: 'v3',
        transformParams: async ({ params }) => {
          // The wire value is authoritative: it is what `num_ctx` the request really carries
          // (a user-set smaller value or a later clamp can be below the frozen snapshot).
          const wireNumCtx = readOllamaWireNumCtx(params.providerOptions ?? {}) ?? snapshot.numCtx
          await assertPrimaryOllamaCallWithinWindow({
            call: params,
            provider: scope.provider,
            model: scope.model,
            ollamaNumCtx: { ...snapshot, numCtx: wireNumCtx }
          })
          return params
        }
      })
    }
  })
}

export const ollamaCapacityGuardFeature: RequestFeature = {
  name: 'ollama-capacity-guard',
  applies: (scope) =>
    scope.requestContext?.ollamaNumCtx != null &&
    usesOllamaWirePath(scope.provider, scope.endpointType, scope.sdkConfig?.providerId),
  contributeModelAdapters: (scope) => [createOllamaCapacityGuardPlugin(scope)]
}
