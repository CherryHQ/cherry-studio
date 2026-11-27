import { minimaxCli } from './cli'

export { readMiniMaxSubscriptionUsage } from './accountUsage'

function minimaxModelId(model: string) {
  const slash = model.indexOf('/')
  return slash > 0
    ? 'm:' + encodeURIComponent(model.slice(0, slash)) + ':' + encodeURIComponent(model.slice(slash + 1)) + ':v:'
    : model
}

export const minimaxPreset = {
  id: minimaxCli.id,
  catalogId: minimaxModelId,
  profile: { format: 'yaml', target: 'minimax-config', path: ['defaultModel'] }
} as const
