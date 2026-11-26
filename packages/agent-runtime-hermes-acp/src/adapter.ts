import { acpConfigRecord, acpGatewayPath, type AcpGatewayConfig } from '@cherrystudio/agent-runtime-acp/profile'

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

export const hermesPreset = {
  id: hermesCli.id,
  gateway: hermesGateway,
  catalogId: hermesModelId,
  profile: { format: 'yaml', target: 'hermes-config', path: ['model', 'default'] }
} as const
