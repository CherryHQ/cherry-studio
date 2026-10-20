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
    // K3 supports low/high/max thinking effort and can disable thinking; K3 Fast
    // exposes the same effort vocabulary but is always-on.
    { pattern: '^kimi-k3$', effort: ['low', 'high', 'max'], toggle: true },
    { pattern: '^kimi-k3-fast$', effort: ['low', 'high', 'max'] },
    // Kimi K2.5+ exposes the thinking toggle; kimi-k2-thinking is always-on.
    { pattern: '^kimi-k2[.-][5-9]\\d*', toggle: true },
    // The thinking budget is a K2.x-era knob — K3 controls depth via
    // `reasoning_effort` only (platform.kimi.com thinking-effort guide).
    { pattern: 'kimi-k2[.-][5-9]\\d*', budget: { min: 0, max: 30720 }, template: true },
    // Membership profiles (no knobs): reasoning SKUs beyond the knob rules above.
    { pattern: '^kimi-k2-thinking(?:-turbo)?$|^kimi-k(?:2[.-][5-9]\\d*|[3-9]\\d*(?:[.-]\\d+)?)(?:-[\\w-]+)?$' }
  ]
})
