import { findSchema, consoleSchema, networkSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { browserResult } from './result'

export async function handleFind(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = findSchema.parse(args ?? {})
  return browserResult(controller, input, signal, (session, options) => session.find(input, options))
}

export async function handleConsoleMessages(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = consoleSchema.parse(args ?? {})
  return browserResult(controller, input, signal, async (session, options) => {
    await session.send('Runtime.enable', undefined, options)
    return session.consoleMessages(input.level, input.clear)
  })
}

export async function handleNetworkRequests(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = networkSchema.parse(args ?? {})
  return browserResult(controller, input, signal, async (session, options) => {
    await session.send('Network.enable', undefined, options)
    return session.networkRequests(input.clear)
  })
}
