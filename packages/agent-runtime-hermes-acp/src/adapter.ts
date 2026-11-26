import {
  acpConfigRecord,
  acpGatewayPath,
  type AcpCliInstaller,
  type AcpGatewayConfig
} from '@cherrystudio/agent-runtime-acp/profile'

import { hermesCli } from './cli'

function hermesModelId(model: string) {
  return 'custom:' + model
}

const hermesGateway = {
  format: 'yaml',
  envFile: 'hermes-env',
  read(doc, _model, env) {
    const model = acpConfigRecord(doc.model)
    return {
      baseUrl: model?.base_url,
      apiKey: env('CHERRY_HERMES_API_KEY'),
      model: model?.default,
      path: acpGatewayPath(model?.api_mode)
    }
  }
} satisfies AcpGatewayConfig<'hermes-env'>

const installer = {
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
} satisfies AcpCliInstaller

export const hermesPreset = {
  id: hermesCli.id,
  installer,
  gateway: hermesGateway,
  catalogId: hermesModelId,
  installation: 'native-cli',
  profile: { format: 'yaml', target: 'hermes-config', path: ['model', 'default'] }
} as const
