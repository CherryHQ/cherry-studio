import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'
import type { CliInstaller } from '@cherrystudio/agent-runtime/cli'

export const hermesCli = {
  modelConfig: { target: 'hermes-config', overrides: ['HERMES_HOME'] },
  id: 'hermes',
  nativeCliInstall: true,
  terminalArgs: [],
  permissionMode: {
    values: { ask: 'default', workspace_session: 'acceptEdits', session: 'auto' },
    configIds: ['edit_approval_policy'],
    approvalConfigId: 'edit_approval_policy'
  },
  name: 'Hermes',
  protocol: 'acp',
  executable: 'hermes',
  args: ['acp'],
  helpUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/'
} as const satisfies AcpCliPreset<'hermes-config'>

export const hermesInstaller = {
  executable: 'hermes',
  script(platform, targetVersion) {
    if (targetVersion) throw new Error('Hermes manages its own updates')
    return platform === 'win32'
      ? {
          manager: 'script',
          command: 'powershell.exe',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "$ErrorActionPreference = 'Stop'; & ([scriptblock]::Create((irm https://hermes-agent.nousresearch.com/install.ps1))) -NonInteractive; if ($LASTEXITCODE) { exit $LASTEXITCODE }"
          ]
        }
      : {
          manager: 'script',
          command: 'bash',
          args: [
            '-o',
            'pipefail',
            '-c',
            'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive'
          ]
        }
  },
  removal: {
    kind: 'command',
    probe: ['uninstall', '--help'],
    accepts: (help) => /hermes/i.test(help) && /--yes\b/.test(help) && /--full\b/.test(help),
    // Omitting --full preserves configuration, sessions and named profiles.
    args: ['uninstall', '--yes'],
    fallback: { manager: 'uv', package: 'hermes-agent' }
  }
} satisfies CliInstaller
