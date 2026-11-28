import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const traeCli = {
  id: 'trae',
  account: { methods: [] },
  loginArgs: ['login'],
  accountProbe: {
    args: ['login', 'status'],
    signedOutExitCode: 1,
    parse(output: string) {
      if (/^Not logged in\b/m.test(output)) return { status: 'signed-out' } as const
      if (/^Logged in\b/m.test(output)) return { status: 'signed-in' } as const
      return { status: 'unknown' } as const
    }
  },
  name: 'TRAE CN',
  protocol: 'acp',
  executable: 'traecli',
  args: ['acp', 'serve'],
  helpUrl: 'https://docs.trae.cn/cli_agent-client-protocol'
} as const satisfies AcpCliPreset

export function traeInstall(platform: string) {
  if (platform === 'win32')
    return {
      manager: 'script' as const,
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference = 'Stop'; irm https://trae.cn/trae-cli/install_v2.ps1 | iex"
      ]
    }
  if (platform === 'darwin' || platform === 'linux')
    return {
      manager: 'script' as const,
      command: 'bash',
      args: ['-o', 'pipefail', '-c', 'curl -fsSL https://trae.cn/trae-cli/install_v2.sh | bash']
    }
}
