// [v2] TODO: The legacy app/model/provider PNG/WebP logos were removed by the icon-system
// overhaul (#12858). Mini-apps map to brand icon refs from @cherrystudio/ui/icons as a
// stop-gap. A proper design should decouple mini-app icon resolution (e.g. a dedicated
// registry) rather than hard-coding catalog keys here.

import type { CompoundIcon } from '@cherrystudio/ui'
import { type IconRef, modelIconRef, providerIconRef, useIcon } from '@cherrystudio/ui/icons'

/**
 * Mini-app logo id → exact catalog ref. Keys are compile-time checked against
 * the generated meta catalogs; refs resolve synchronously, the icon component
 * loads async via `useMiniAppLogo`. Exact-key lookup on purpose: the provider
 * alias table would remap ids like `doubao` (→ volcengine) away from the
 * dedicated brand icon these mini-apps want.
 */
const MINI_APP_ICON_REFS: Record<string, IconRef> = {
  application: providerIconRef('application'),
  'radeon-cloud': providerIconRef('radeon-cloud'),
  openclaw: providerIconRef('openclaw'),
  openai: providerIconRef('openai'),
  gemini: providerIconRef('google'),
  google: providerIconRef('google'),
  silicon: providerIconRef('silicon'),
  deepseek: providerIconRef('deepseek'),
  zeroone: providerIconRef('zero-one'),
  zhipu: providerIconRef('zhipu'),
  moonshot: providerIconRef('moonshot'),
  baichuan: providerIconRef('baichuan'),
  qwen: providerIconRef('qwen'),
  dashscope: providerIconRef('qwen'),
  step: providerIconRef('step'),
  stepfun: providerIconRef('step'),
  doubao: providerIconRef('doubao'),
  bytedance: providerIconRef('bytedance'),
  minimax: providerIconRef('minimax-agent'),
  groq: providerIconRef('groq'),
  anthropic: providerIconRef('anthropic'),
  claude: providerIconRef('anthropic'),
  wenxin: providerIconRef('wenxin'),
  baidu: providerIconRef('baidu'),
  yuanbao: providerIconRef('yuanbao'),
  sensetime: providerIconRef('sensetime'),
  xinghuo: providerIconRef('xinghuo'),
  metaso: providerIconRef('metaso'),
  poe: providerIconRef('poe'),
  perplexity: providerIconRef('perplexity'),
  devv: providerIconRef('devv'),
  tng: providerIconRef('tng'),
  felo: providerIconRef('felo'),
  duck: providerIconRef('duck'),
  namiai: providerIconRef('nami-ai'),
  thinkany: providerIconRef('think-any'),
  githubcopilot: providerIconRef('github-copilot'),
  genspark: providerIconRef('genspark'),
  grok: providerIconRef('grok'),
  twitter: providerIconRef('twitter'),
  flowith: providerIconRef('flowith'),
  mintop3: providerIconRef('3min-top'),
  '3mintop': providerIconRef('3min-top'),
  aistudio: providerIconRef('ai-studio'),
  xiaoyi: providerIconRef('xiaoyi'),
  notebooklm: providerIconRef('notebooklm'),
  coze: providerIconRef('coze'),
  dify: providerIconRef('dify'),
  lingxi: providerIconRef('lingxi'),
  mistral: providerIconRef('mistral'),
  abacus: providerIconRef('abacus'),
  lambda: providerIconRef('lambda'),
  monica: providerIconRef('monica'),
  zhida: providerIconRef('zhida'),
  zai: providerIconRef('z-ai'),
  n8n: providerIconRef('n8n'),
  you: providerIconRef('you'),
  longcat: providerIconRef('longcat'),
  bolt: providerIconRef('bolt-new'),
  huggingface: providerIconRef('huggingface'),
  ima: providerIconRef('ima'),
  dangbei: providerIconRef('dangbei'),
  hailuo: modelIconRef('hailuo'),
  ling: modelIconRef('ling')
}

export function getMiniAppsLogoRef(logoId: string | undefined): IconRef | undefined {
  if (!logoId) return undefined
  return MINI_APP_ICON_REFS[logoId.toLowerCase()]
}

/** Async-loaded CompoundIcon for a mini-app logo id; undefined while loading or when unknown. */
export function useMiniAppLogo(logoId: string | undefined): CompoundIcon | undefined {
  return useIcon(getMiniAppsLogoRef(logoId))
}
