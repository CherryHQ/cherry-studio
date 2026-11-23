import { SnapshotSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { browserResult } from './result'

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The MCP registry erases per-tool arguments; SnapshotSchema validates target and snapshot options, including omitted-input defaults.
export async function handleSnapshot(controller: BrowserController, args: unknown, signal?: AbortSignal) {
  const { tabId, privateMode, ...options } = SnapshotSchema.parse(args ?? {})

  return browserResult(controller, { tabId, privateMode }, signal, async (session, commands) => ({
    snapshot: (await session.snapshot(options, commands)).text
  }))
}
