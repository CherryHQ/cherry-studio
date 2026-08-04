/**
 * AI SDK DevTools middleware — captures input params, output content,
 * tool calls, token usage, and raw provider request/response payloads
 * into a local store the official `@ai-sdk/devtools` UI reads from.
 *
 * Opt-in in a dev build. The middleware rewrites its full JSON store
 * synchronously, so enabling it for every request can block Electron's main
 * thread once the capture grows. To inspect:
 *
 *   AI_SDK_DEVTOOLS=1 pnpm dev
 *   npx @ai-sdk/devtools          # then open http://localhost:4983
 */

import { devToolsMiddleware } from '@ai-sdk/devtools'
import { definePlugin } from '@cherrystudio/ai-core'
import { isDev } from '@main/core/platform'

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
  applies: () => isDev && process.env.AI_SDK_DEVTOOLS === '1',
  contributeModelAdapters: () => [createDevToolsPlugin()]
}
