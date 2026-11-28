import type { Daemon } from '@qoder-ai/qoder-agent-sdk'

import type { SubscriptionUsageResult } from '@cherrystudio/agent-runtime'
import { withStartupSignal, type LaunchSpec, type SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

export async function readQoderSubscriptionUsage(
  region: 'cn' | 'global',
  launch: LaunchSpec,
  _spawn: SpawnStdio,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  let daemon: Pick<Daemon, 'stop' | 'getUsageInfo'> | undefined
  let stopping: Promise<void> | undefined
  const stop = async () => {
    if (daemon) await (stopping ??= daemon.stop())
  }
  try {
    return await withStartupSignal(
      signal,
      async (): Promise<SubscriptionUsageResult> => {
        const china = region === 'cn'
        const { accessToken, qodercliAuth, startDaemon } = china
          ? await import('@qodercn-ai/qodercn-agent-sdk')
          : await import('@qoder-ai/qoder-agent-sdk')
        signal.throwIfAborted()
        const token = (
          china ? launch.env.QODERCN_PERSONAL_ACCESS_TOKEN : launch.env.QODER_PERSONAL_ACCESS_TOKEN
        )?.trim()
        daemon = await startDaemon({
          pathToQoderCLIExecutable: launch.executable,
          env: { ...launch.env },
          initializeTimeoutMs: 10_000,
          debugFile: '',
          auth: token ? accessToken(token) : qodercliAuth()
        })
        signal.throwIfAborted()
        const usage = await daemon.getUsageInfo()
        if (!usage) return { status: 'unavailable' }
        const buckets = [
          { id: 'plan', label: 'Qoder', used: usage.userQuota?.used, limit: usage.userQuota?.total },
          { id: 'add-on', label: 'Qoder Add-on', used: usage.addOnQuota?.used, limit: usage.addOnQuota?.total },
          {
            id: 'organization',
            label: 'Qoder Organization',
            used: usage.orgResourcePackage?.used,
            limit: usage.orgResourcePackage?.cap
          }
        ]
        const windows = buckets.flatMap(({ id, label, used, limit }) =>
          typeof limit === 'number' && limit > 0 && typeof used === 'number' && Number.isFinite(used) && used >= 0
            ? [{ id, label, usedRatio: used / limit }]
            : []
        )
        return windows.length ? { status: 'available', readAt: Date.now(), windows } : { status: 'unavailable' }
      },
      stop
    )
  } catch (error) {
    signal.throwIfAborted()
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'AUTH_FAILED' || error.code === 'AUTH_PAYLOAD_REQUIRED') return { status: 'signed-out' }
      if (error.code === 'METHOD_NOT_FOUND' || error.code === -32601) return { status: 'unsupported' }
    }
    return { status: 'unavailable' }
  } finally {
    await stop()
  }
}
