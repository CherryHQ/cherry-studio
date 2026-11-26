import type { CliInstaller } from '@cherrystudio/agent-runtime/cli'
import type { AcpLoginProfile, AcpPermissionModes } from '@cherrystudio/agent-runtime/cli'

export const antigravityCli = {
  id: 'antigravity-acp',
  permissionMode: {
    values: { default: 'default', autoedit: 'acceptEdits', 'auto-edit': 'acceptEdits', yolo: 'bypassPermissions' },
    labels: { default: 'default', 'auto edit': 'acceptEdits', yolo: 'bypassPermissions' }
  } satisfies AcpPermissionModes,
  modelEndpoints: ['google-generate-content'],
  terminalArgs: [],
  loginArgs: ['acp', '--login'],
  auth: {
    catalogRequiresLogin: true,
    methods: [
      { id: 'oauth-personal', form: 'browser', name: 'Google' },
      { id: 'oauth-business', form: 'enterprise', name: 'Gemini Enterprise' },
      { id: 'gemini-api-key', form: 'api-key', name: 'Gemini', apiKey: 'GEMINI_API_KEY' },
      {
        id: 'agent-platform',
        form: 'cloud',
        name: 'Gemini Enterprise Agent Platform',
        apiKey: 'GOOGLE_API_KEY',
        project: 'GOOGLE_CLOUD_PROJECT',
        location: 'GOOGLE_CLOUD_LOCATION'
      }
    ]
  } satisfies AcpLoginProfile,
  name: 'Google Antigravity',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'agy',
  managedPackage: 'google-antigravity/antigravity-cli',
  nativeCliInstall: true,
  minimumAcpVersion: '1.5.0',
  args: ['acp'],
  helpUrl: 'https://antigravity.google/docs/cli/acp/'
} as const

export const antigravityInstaller = {
  executable: antigravityCli.executable,
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
} satisfies CliInstaller
