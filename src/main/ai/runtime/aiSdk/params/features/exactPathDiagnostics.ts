import { definePlugin } from '@cherrystudio/ai-core'
import { createExactPathDiagnosticsMiddleware } from '@main/ai/utils/exactPathDiagnostics'

import type { RequestFeature } from '../feature'

export const exactPathDiagnosticsFeature: RequestFeature = {
  name: 'exact-path-diagnostics',
  applies: (scope) => Boolean(scope.sdkConfig.exactRequestUrl),
  contributeModelAdapters: (scope) => [
    definePlugin({
      name: 'exact-path-diagnostics',
      enforce: 'post',
      configureContext: (context) => {
        context.middlewares ??= []
        context.middlewares.push(createExactPathDiagnosticsMiddleware(scope.sdkConfig.exactRequestUrl!))
      }
    })
  ]
}
