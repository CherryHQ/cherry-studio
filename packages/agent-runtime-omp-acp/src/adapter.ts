import { type AcpYamlModelProfile } from '@cherrystudio/agent-runtime-acp/profile'

export const ompModelProfile: AcpYamlModelProfile<'omp-settings'> = {
  format: 'yaml',
  target: 'omp-settings',
  readModel(doc) {
    const provider = doc.getIn(['defaultProvider'])
    const model = doc.getIn(['defaultModel'])
    if (typeof model !== 'string' || !model) return undefined
    return typeof provider === 'string' && provider ? `${provider}/${model}` : model
  },
  writeModel(doc, model) {
    const slash = model?.indexOf('/') ?? -1
    if (model && slash > 0 && slash < model.length - 1) {
      doc.setIn(['defaultProvider'], model.slice(0, slash))
      doc.setIn(['defaultModel'], model.slice(slash + 1))
    } else {
      if (doc.hasIn(['defaultProvider'])) doc.deleteIn(['defaultProvider'])
      if (model !== undefined) doc.setIn(['defaultModel'], model)
      else if (doc.hasIn(['defaultModel'])) doc.deleteIn(['defaultModel'])
    }
  }
}
