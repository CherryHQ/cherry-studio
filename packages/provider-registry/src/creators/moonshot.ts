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
    // K2.7-code only accepts thinking type 'enabled' (platform.kimi.com
    // claude-code guide: requests without it are rejected) — always-on, the
    // explicit `toggle: false` stops the generic toggle below.
    { pattern: '^kimi-k2[.-]7-code', toggle: false },
    // Kimi K2.5+/K3+ expose the thinking toggle; kimi-k2-thinking is always-on.
    { pattern: '^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)', toggle: true },
    // The thinking budget is a K2.x-era knob — K3 controls depth via
    // `reasoning_effort` only (platform.kimi.com thinking-effort guide).
    { pattern: 'kimi-k2[.-][5-9]\\d*', budget: { min: 0, max: 30720 }, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '^kimi-k2-thinking(?:-turbo)?$|^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)(?:-[\\w-]+)?$' }
  ]
})
