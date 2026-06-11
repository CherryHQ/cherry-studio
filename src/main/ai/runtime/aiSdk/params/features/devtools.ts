/**
 * AI SDK DevTools middleware — captures input params, output content,
 * tool calls, token usage, and raw provider request/response payloads
 * into a local store the official `@ai-sdk/devtools` UI reads from.
 *
 * Active only when `app.developer_mode.enabled` is on. To inspect:
 *
 *   npx @ai-sdk/devtools          # then open http://localhost:4983
 *
 * The middleware writes data locally in plain text — for development
 * only, never enable in production builds.
 */

import { devToolsMiddleware } from '@ai-sdk/devtools'
import { definePlugin } from '@cherrystudio/ai-core'
import { application } from '@main/core/application'

import type { RequestFeature } from '../feature'

function createDevToolsPlugin() {
  return definePlugin({
    name: 'ai-sdk-devtools',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(devToolsMiddleware())
    }
  })
}

export const devtoolsFeature: RequestFeature = {
  name: 'ai-sdk-devtools',
  applies: () => Boolean(application.get('PreferenceService').get('app.developer_mode.enabled')),
  contributeModelAdapters: () => [createDevToolsPlugin()]
}
