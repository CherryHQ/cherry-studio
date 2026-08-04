import { openaiCompatible } from './_api'
import { defineCreator } from './types'

export default defineCreator({
  id: 'moonshot',
  name: 'Moonshot AI (Kimi)',
  fetchModels: openaiCompatible('moonshot', 'MOONSHOT_API_KEY'),
  modelsDevProviders: ['moonshotai', 'moonshotai-cn'],
  families: ['kimi'],
  idPrefixes: ['kimi', 'moonshot'],
  // `$web_search` is the K2-line protocol (platform.kimi.com/docs/guide/use-web-search). On kimi-k3
  // the byte-identical documented round-trip — echoed arguments plus the required `name` — returns
  // 400 `tokenization failed` (reproduced live; same report on the vendor forum), because K3 moved
  // built-in search to the Formula API tools channel (docs/guide/use-official-tools). Declaring it
  // here would route K3 to the server side and fail every request, so it stays out until that
  // channel is implemented. `kimi-latest` tracks whatever is newest, so it inherits that risk and
  // stays out too — a wrong declaration 400s every request, a missing one just falls back to the
  // client search backend.
  serverTools: { 'web-search': ['kimi-k2'] },
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
