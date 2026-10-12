import type { CompoundIcon } from '@cherrystudio/ui'
import { type IconRef, modelIconRef, providerIconRef, useIcon } from '@cherrystudio/ui/icons'
import aiStudio from '@renderer/assets/images/miniApps/ai-studio.png'
import antAfu from '@renderer/assets/images/miniApps/ant-afu.png'
import baixiaoyi from '@renderer/assets/images/miniApps/baixiaoyi.png'
import canva from '@renderer/assets/images/miniApps/canva.png'
import chatglm from '@renderer/assets/images/miniApps/chatglm.png'
import claude from '@renderer/assets/images/miniApps/claude.png'
import cozeChina from '@renderer/assets/images/miniApps/coze-cn.png'
import dangbei from '@renderer/assets/images/miniApps/dangbei.png'
import dola from '@renderer/assets/images/miniApps/dola.png'
import gamma from '@renderer/assets/images/miniApps/gamma.png'
import gemini from '@renderer/assets/images/miniApps/gemini.png'
import grok from '@renderer/assets/images/miniApps/grok.svg?url'
import jimeng from '@renderer/assets/images/miniApps/jimeng.png'
import kimi from '@renderer/assets/images/miniApps/kimi.png'
import kling from '@renderer/assets/images/miniApps/kling.png'
import lovable from '@renderer/assets/images/miniApps/lovable.png'
import miaoda from '@renderer/assets/images/miniApps/miaoda.png'
import minimaxAgent from '@renderer/assets/images/miniApps/minimax-agent.png'
import napkin from '@renderer/assets/images/miniApps/napkin.png'
import notebook from '@renderer/assets/images/miniApps/notebook.svg?url'
import qianwen from '@renderer/assets/images/miniApps/qianwen.png'
import stepfun from '@renderer/assets/images/miniApps/stepfun.svg?url'
import suno from '@renderer/assets/images/miniApps/suno.png'
import tiangong from '@renderer/assets/images/miniApps/tiangong.svg?url'
import tingwu from '@renderer/assets/images/miniApps/tingwu.png'
import v0 from '@renderer/assets/images/miniApps/v0.png'
import wanzhi from '@renderer/assets/images/miniApps/wanzhi.png'
import wenxin from '@renderer/assets/images/miniApps/wenxin.png'
import yuanbao from '@renderer/assets/images/miniApps/yuanbao.png'

const MINI_APP_IMAGES: Record<string, string> = {
  jimeng,
  kling,
  'coze-cn': cozeChina,
  miaoda,
  tingwu,
  'ant-afu': antAfu,
  gamma,
  canva,
  dangbei,
  suno,
  napkin,
  lovable,
  v0,
  aistudio: aiStudio,
  baichuan: baixiaoyi,
  bytedance: dola,
  claude,
  gemini,
  grok,
  'minimax-agent-cn': minimaxAgent,
  moonshot: kimi,
  notebooklm: notebook,
  qianwen,
  step: stepfun,
  tng: tiangong,
  wenxin,
  yuanbao,
  zeroone: wanzhi,
  zhipu: chatglm
}

export function getMiniAppLogoSource(logo: string | undefined): string | undefined {
  return logo ? (MINI_APP_IMAGES[logo.toLowerCase()] ?? logo) : undefined
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
  'radeon-cloud': providerIconRef('radeon-cloud'),
  openclaw: providerIconRef('openclaw'),
  nousresearch: providerIconRef('nousresearch'),
  openai: providerIconRef('openai'),
  google: providerIconRef('google'),
  silicon: providerIconRef('silicon'),
  deepseek: providerIconRef('deepseek'),
  qwen: providerIconRef('qwen'),
  dashscope: providerIconRef('qwen'),
  stepfun: providerIconRef('step'),
  doubao: providerIconRef('doubao'),
  minimax: providerIconRef('minimax-agent'),
  groq: providerIconRef('groq'),
  anthropic: providerIconRef('anthropic'),
  baidu: providerIconRef('baidu'),
  sensetime: providerIconRef('sensetime'),
  xinghuo: providerIconRef('xinghuo'),
  metaso: providerIconRef('metaso'),
  poe: providerIconRef('poe'),
  perplexity: providerIconRef('perplexity'),
  devv: providerIconRef('devv'),
  felo: providerIconRef('felo'),
  duck: providerIconRef('duck'),
  namiai: providerIconRef('nami-ai'),
  thinkany: providerIconRef('think-any'),
  github: providerIconRef('github'),
  githubcopilot: providerIconRef('github-copilot'),
  genspark: providerIconRef('genspark'),
  twitter: providerIconRef('twitter'),
  flowith: providerIconRef('flowith'),
  mintop3: providerIconRef('3min-top'),
  '3mintop': providerIconRef('3min-top'),
  xiaoyi: providerIconRef('xiaoyi'),
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
