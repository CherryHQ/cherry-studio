import {
  createMessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter
} from 'vscode-jsonrpc/node.js'
import * as z from 'zod'

import type { RuntimeAccountResult, SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import type { LaunchSpec, SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

const handshake = z.object({ protocolVersion: z.number().int().positive() })
const authStatus = z.object({ isAuthenticated: z.boolean(), login: z.string().nullish() })
const quotaReply = z.object({
  quotaSnapshots: z.record(
    z.string(),
    z.object({
      entitlementRequests: z.number(),
      usedRequests: z.number().nonnegative(),
      remainingPercentage: z.number().optional(),
      resetDate: z.string().nullish()
    })
  )
})

async function queryCopilotAccount<T>(
  launch: LaunchSpec,
  spawn: SpawnStdio,
  signal: AbortSignal,
  query: (rpc: ReturnType<typeof createMessageConnection>) => Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  const child = spawn({ ...launch, args: ['--headless', '--stdio', '--no-auto-update'] })
  child.stderr.resume()
  const rpc = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin))
  const cancel = () => rpc.dispose()
  const stop = () => void child.closeAndJoin().catch(() => {})
  signal.addEventListener('abort', cancel, { once: true })
  signal.addEventListener('abort', stop, { once: true })
  void child.closed.then(cancel)
  rpc.onError(cancel)
  rpc.onClose(cancel)
  try {
    rpc.listen()
    handshake.parse(await rpc.sendRequest('connect', { supportedTaskKinds: [] }))
    const result = await query(rpc)
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', cancel)
    signal.removeEventListener('abort', stop)
    rpc.dispose()
    await child.closeAndJoin()
  }
}

export function readCopilotAccount(
  launch: LaunchSpec,
  spawn: SpawnStdio,
  signal: AbortSignal
): Promise<RuntimeAccountResult> {
  return queryCopilotAccount<RuntimeAccountResult>(launch, spawn, signal, async (rpc) => {
    const auth = authStatus.parse(await rpc.sendRequest('auth.getStatus', {}))
    if (!auth.isAuthenticated) return { status: 'signed-out' }
    return { status: 'signed-in', ...(auth.login && { account: { displayName: auth.login } }) }
  })
}

export async function readCopilotSubscriptionUsage(
  launch: LaunchSpec & { readonly model?: string },
  spawn: SpawnStdio,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  if (launch.model?.includes('/')) return { status: 'unsupported' }
  try {
    return await queryCopilotAccount<SubscriptionUsageResult>(launch, spawn, signal, async (rpc) => {
      const auth = authStatus.parse(await rpc.sendRequest('auth.getStatus', {}))
      if (!auth.isAuthenticated) return { status: 'signed-out' }
      const { quotaSnapshots } = quotaReply.parse(await rpc.sendRequest('account.getQuota', {}))
      const windows = Object.entries(quotaSnapshots).flatMap(([id, quota]) => {
        if (quota.entitlementRequests <= 0) return []
        const end = Date.parse(quota.resetDate ?? '')
        return [
          {
            id,
            label: id.replaceAll('_', ' '),
            usedRatio: quota.usedRequests / quota.entitlementRequests,
            resetsAt: Number.isFinite(end) ? end : undefined
          }
        ]
      })
      return windows.length ? { status: 'available', readAt: Date.now(), windows } : { status: 'unsupported' }
    })
  } catch (error) {
    signal.throwIfAborted()
    return { status: error instanceof ResponseError && error.code === -32601 ? 'unsupported' : 'unavailable' }
  }
}
