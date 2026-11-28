import { hermesCli } from './cli'

function hermesModelId(model: string) {
  return 'custom:' + model
}

export const hermesPreset = {
  id: hermesCli.id,
  catalogId: hermesModelId,
  profile: { format: 'yaml', target: 'hermes-config', path: ['model', 'default'] }
} as const
