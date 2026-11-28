import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

import { openClawCli } from './cli'

const openClawAcpAdapter: AcpHarnessAdapter = {
  // Only load restores the bridge's UUID mappings in a fresh process.
  preferredRestore: 'load',
  bind: () => ({ promptMeta: { prefixCwd: false } })
}

export function openClawEnvironment(stateDirectory: string, configFile: string) {
  return { OPENCLAW_STATE_DIR: stateDirectory, OPENCLAW_CONFIG_PATH: configFile, OPENCLAW_NO_AUTO_UPDATE: '1' }
}

export async function attachOpenClawGateway(
  overrides: Record<string, string>,
  launch: { args: string[]; env: Record<string, string> },
  acquire: () => Promise<{ url: string; token?: string; dispose(): Promise<void> }>
) {
  if (
    overrides.OPENCLAW_STATE_DIR ||
    overrides.OPENCLAW_CONFIG_PATH ||
    overrides.OPENCLAW_GATEWAY_URL ||
    launch.args.some((arg) => arg === '--url' || arg.startsWith('--url='))
  )
    return
  const lease = await acquire()
  launch.env.OPENCLAW_GATEWAY_URL = lease.url
  if (lease.token) launch.env.OPENCLAW_GATEWAY_TOKEN = lease.token
  return lease
}

export const openClawPreset = {
  id: openClawCli.id,
  protocol: openClawAcpAdapter,
  sessionMcp: 'unsupported',
  installation: 'native-cli'
} as const
