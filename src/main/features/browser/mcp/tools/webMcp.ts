import { webMcpListSchema, webMcpCallSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { browserResult } from './result'

export async function handleListWebTools(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = webMcpListSchema.parse(args ?? {})
  return browserResult(controller, input, signal, (session, options) => session.webTools.list(options))
}

export async function handleCallWebTool(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = webMcpCallSchema.parse(args)
  return browserResult(controller, input, signal, (session, options) =>
    session.webTools.call(input.toolId, input.args, options)
  )
}
