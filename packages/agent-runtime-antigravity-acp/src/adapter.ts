import type { AcpCliInstaller, AcpEnv } from '@cherrystudio/agent-runtime-acp/profile'
import type { AcpHarnessAdapter } from '@cherrystudio/agent-runtime-acp/v1'

import { antigravityCli } from './cli'

const antigravityAcpAdapter: AcpHarnessAdapter = { hostMutations: 'disabled' }
const antigravityFallback = {
  executable: antigravityCli.terminalCli.executable,
  args: ['acp'],
  retry(error: unknown) {
    return error instanceof Error && /no authentication method selected/i.test(error.message)
  }
}

export function antigravityEnvironment(
  child: Record<string, string>,
  overrides: Record<string, string>,
  applied: AcpEnv,
  hasAppliedRules: boolean,
  merge: (...sources: AcpEnv[]) => Record<string, string>
) {
  // The adapter uses WebSocket-specific proxy variables when python-socks is unavailable.
  const agentProxy = Object.keys(overrides).some((key) => /^(https?|all|socks)_proxy$/i.test(key))
  const useAppliedProxy = !agentProxy && hasAppliedRules
  if (useAppliedProxy) child = merge(child, applied, overrides)
  const proxyEnv = agentProxy ? merge(overrides) : useAppliedProxy ? applied : child
  const secure = proxyEnv.https_proxy ?? proxyEnv.HTTPS_PROXY
  const general = proxyEnv.all_proxy ?? proxyEnv.ALL_PROXY
  const proxies = {
    WS_PROXY: secure ?? proxyEnv.http_proxy ?? proxyEnv.HTTP_PROXY ?? general,
    WSS_PROXY: secure ?? general
  }
  for (const [key, proxy] of Object.entries(proxies)) {
    if (!(key in child) && !(key.toLowerCase() in child) && proxy && /^https?:\/\//i.test(proxy)) child[key] = proxy
  }
  return child
}

const installer = {
  executable: antigravityCli.terminalCli.executable,
  script(platform, targetVersion) {
    if (targetVersion) throw new Error('Antigravity manages its own updates')
    return platform === 'win32'
      ? {
          manager: 'script',
          command: 'powershell.exe',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "$ErrorActionPreference = 'Stop'; irm https://antigravity.google/cli/install.ps1 | iex"
          ]
        }
      : {
          manager: 'script',
          command: 'bash',
          args: ['-o', 'pipefail', '-c', 'curl -fsSL https://antigravity.google/cli/install.sh | bash']
        }
  },
  removal: { kind: 'file', identity: /\b(?:antigravity|agy)\b/i }
} satisfies AcpCliInstaller

export const antigravityPreset = {
  id: antigravityCli.id,
  installer,
  protocol: antigravityAcpAdapter,
  cliFallback: antigravityFallback
}
