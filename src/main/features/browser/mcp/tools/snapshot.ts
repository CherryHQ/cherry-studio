import { SnapshotSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { browserResult } from './result'

export async function handleSnapshot(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const { tabId, privateMode, ...options } = SnapshotSchema.parse(args ?? {})
  return browserResult(controller, { tabId, privateMode }, signal, async (session, commands) => ({
    snapshot: (await session.snapshot(options, commands)).text
  }))
}
