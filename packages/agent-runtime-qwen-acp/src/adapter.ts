import { acpConfigRecord, type AcpJsonModelProfile } from '@cherrystudio/agent-runtime-acp/profile'

import { qwenCli } from './cli'

function qwenModelId(model: string) {
  return model + '(openai)'
}

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
  profile: qwenProfile,
  catalogId: qwenModelId
} as const
