// [v2] TODO: The legacy app/model/provider PNG/WebP logos were removed by the icon-system
// overhaul (#12858). Mini-apps map to brand icon refs from @cherrystudio/ui/icons as a
// stop-gap. A proper design should decouple mini-app icon resolution (e.g. a dedicated
// registry) rather than hard-coding catalog keys here.

import type { CompoundIcon } from '@cherrystudio/ui'
import { type IconRef, modelIconRef, providerIconRef, useIcon } from '@cherrystudio/ui/icons'

// Logo ids whose artwork reads as a complete tile design (rounded-square/circular plate)
// and renders edge-to-edge in the launchpad tile. Everything else — bare vector marks and
// wordmark-on-white plates — gets the logo scaled and centered instead. Hand-picked with
// design review.
const FULL_BLEED_LOGO_IDS = new Set([
  '3mintop',
  'mintop3',
  'anthropic',
  'claude',
  'bolt',
  'coze',
  'doubao',
  'genspark',
  'groq',
  'ima',
  'lambda',
  'minimax',
  'notebooklm'
])

export function isMiniAppLogoFullBleed(logoId: string | undefined): boolean {
  return !!logoId && FULL_BLEED_LOGO_IDS.has(logoId.toLowerCase())
}

// Bordered launchpad tiles letterbox the logo via preserveAspectRatio, so a flat
// scale makes long/tall marks (silicon, tng, n8n…) read far smaller than square
// ones. Square and near-square logos (aspect ratio ≤ 1.3, which includes dify/grok)
// all share the 84% base; only clearly elongated marks scale their long edge
// further toward a 92% cap, so every tile reads at a comparable visual weight.
// Values derived from measured glyph bounding boxes; logos not listed here fall
// back to the base.
const MINI_APP_LOGO_SCALE_BASE = 0.84
const MINI_APP_LOGO_SCALE: Record<string, number> = {
  silicon: 0.92,
  tng: 0.92,
  n8n: 0.92,
  metaso: 0.92,
  dify: 0.92,
  mistral: 0.87,
  flowith: 0.87,
  longcat: 0.87,
  deepseek: 0.86
}

export function getMiniAppLogoScale(logoId: string | undefined): number {
  if (!logoId) return MINI_APP_LOGO_SCALE_BASE
  return MINI_APP_LOGO_SCALE[logoId.toLowerCase()] ?? MINI_APP_LOGO_SCALE_BASE
}

/**
 * Mini-app logo id → exact catalog ref. Keys are compile-time checked against
 * the generated meta catalogs; refs resolve synchronously, the icon component
 * loads async via `useMiniAppLogo`. Exact-key lookup on purpose: the provider
 * alias table would remap ids like `doubao` (→ volcengine) away from the
 * dedicated brand icon these mini-apps want.
 */
const MINI_APP_ICON_REFS: Record<string, IconRef> = {
  application: providerIconRef('application'),
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
  ling: modelIconRef('ling'),
  skywork: providerIconRef('skywork'),
  tiangong: providerIconRef('skywork')
}

export function getMiniAppsLogoRef(logoId: string | undefined): IconRef | undefined {
  if (!logoId) return undefined
  return MINI_APP_ICON_REFS[logoId.toLowerCase()]
}

/** Async-loaded CompoundIcon for a mini-app logo id; undefined while loading or when unknown. */
export function useMiniAppLogo(logoId: string | undefined): CompoundIcon | undefined {
  return useIcon(getMiniAppsLogoRef(logoId))
}
