import {
  acpConfigRecord,
  type AcpJsonModelProfile,
  type AcpGatewayConfig
} from '@cherrystudio/agent-runtime-acp/profile'

import { qwenCli } from './cli'

function qwenModelId(model: string) {
  return model + '(openai)'
}

const qwenGateway = {
  format: 'json',
  read(doc, model) {
    const models = acpConfigRecord(doc.modelProviders)?.openai
    if (!Array.isArray(models)) return
    const entry = acpConfigRecord(models.find((item) => acpConfigRecord(item)?.id === model))
    if (!entry) return
    return {
      baseUrl: entry.baseUrl,
      apiKey: typeof entry.envKey === 'string' ? acpConfigRecord(doc.env)?.[entry.envKey] : undefined,
      model: entry.id,
      path: '/v1/chat/completions'
    }
  }
} satisfies AcpGatewayConfig

const qwenProfile = {
  format: 'json',
  target: 'qwen-settings',
  writeModel: (_doc, model) => [[['model', 'name'], model]],
  readModel(doc) {
    const model = acpConfigRecord(doc.model)?.name
    return typeof model === 'string' && model ? model : undefined
  }
} satisfies AcpJsonModelProfile<'qwen-settings'>

export const qwenPreset = {
  id: qwenCli.id,
  gateway: qwenGateway,
  profile: qwenProfile,
  catalogId: qwenModelId
} as const
