import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'moonshot',
  name: 'Moonshot AI (Kimi)',
  fetchModels: openaiCompatible('moonshot', 'MOONSHOT_API_KEY'),
  modelsDevProviders: ['moonshotai', 'moonshotai-cn'],
  families: ['kimi'],
  idPrefixes: ['kimi', 'moonshot'],
  reasoningFamilies: [
    // Kimi K2.5+/K3+ expose the thinking toggle; kimi-k2-thinking is always-on.
    { pattern: '^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)', toggle: true },
    { pattern: 'kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)', budget: { min: 0, max: 30720 }, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '^kimi-k2-thinking(?:-turbo)?$|^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)(?:-[\\w-]+)?$' }
  ]
})
