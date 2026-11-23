import { findSchema, consoleSchema, networkSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { browserResult } from './result'

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The heterogeneous handler registry erases per-tool input types; findSchema recovers the checked role/name contract before session lookup.
export async function handleFind(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = findSchema.parse(args ?? {})

  return browserResult(controller, input, signal, (session, options) => session.find(input, options))
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Registry dispatch does not retain the selected tool's argument type; consoleSchema validates level/clear before reading the owned buffer.
export async function handleConsoleMessages(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = consoleSchema.parse(args ?? {})

  return browserResult(controller, input, signal, async (session, options) =>
    session.readConsoleMessages(input.level, input.clear, options)
  )
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The generic tool registry passes opaque arguments; networkSchema establishes the tab/clear options before enabling network inspection.
export async function handleNetworkRequests(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const input = networkSchema.parse(args ?? {})

  return browserResult(controller, input, signal, async (session, options) => {
    await session.send('Network.enable', undefined, options)

    return session.networkRequests(input.clear)
  })
}
