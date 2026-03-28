// [v2] TODO: The legacy app/model/provider PNG/WebP logos were removed by the icon-system
// overhaul (#12858). The imports below are a stop-gap to keep tests green - each mini-app
// now receives a CompoundIcon from @cherrystudio/ui/icons instead of a deleted image URL.
// A proper design should decouple mini-app icon resolution (e.g. a dedicated registry or
// a `resolveMinAppIcon` helper) rather than hard-coding CompoundIcon references here.

import type { CompoundIcon } from '@cherrystudio/ui'
import {
  Abacus,
  AiStudio,
  Anthropic,
  Baichuan,
  Baidu,
  BoltNew,
  Bytedance,
  Coze,
  Deepseek,
  Devv,
  Dify,
  Doubao,
  Duck,
  Felo,
  Flowith,
  Genspark,
  GithubCopilot,
  Google,
  Grok,
  Groq,
  Huggingface,
  Lambda,
  Lingxi,
  Longcat,
  Metaso,
  Minimax,
  MinTop3,
  Mistral,
  Monica,
  Moonshot,
  N8n,
  NamiAi,
  Notebooklm,
  Openai,
  Perplexity,
  Poe,
  Qwen,
  Sensetime,
  Silicon,
  Step,
  ThinkAny,
  Tng,
  Twitter,
  Wenxin,
  Xiaoyi,
  Xinghuo,
  You,
  Yuanbao,
  ZAi,
  ZeroOne,
  Zhida,
  Zhipu
} from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import type { MinAppType } from '@renderer/types'
import { ORIGIN_DEFAULT_MIN_APPS } from '@shared/data/presets/miniapps'

const logger = loggerService.withContext('Config:minapps')

// 加载自定义小程序
const loadCustomMiniApp = async (): Promise<MinAppType[]> => {
  try {
    let content: string
    try {
      content = await window.api.file.read('custom-minapps.json')
    } catch (error) {
      // 如果文件不存在，创建一个空的 JSON 数组
      content = '[]'
      await window.api.file.writeWithId('custom-minapps.json', content)
    }

    const customApps = JSON.parse(content)
    const now = new Date().toISOString()

    return customApps.map((app: any) => ({
      ...app,
      type: 'Custom',
      // Custom apps can use image URLs directly or icon keys
      logo: app.logo && app.logo !== '' ? app.logo : 'application',
      addTime: app.addTime || now,
      supportedRegions: ['CN', 'Global']
    }))
  } catch (error) {
    logger.error('Failed to load custom mini apps:', error as Error)
    return []
  }
}

// All mini apps: built-in defaults + custom apps loaded from user config
let allMinApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]

function updateAllMinApps(apps: MinAppType[]) {
  allMinApps = apps
}

export { allMinApps, loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateAllMinApps }

export function getMiniAppsLogo(LogoId: string | undefined): CompoundIcon | undefined {
  if (!LogoId) {
    return
  }
  switch (LogoId.toLowerCase()) {
    case 'openai':
      return Openai
    case 'gemini':
    case 'google':
      return Google
    case 'silicon':
      return Silicon
    case 'deepseek':
      return Deepseek
    case 'zeroone':
      return ZeroOne
    case 'zhipu':
      return Zhipu
    case 'moonshot':
      return Moonshot
    case 'baichuan':
      return Baichuan
    case 'qwen':
    case 'dashscope':
      return Qwen
    case 'step':
    case 'stepfun':
      return Step
    case 'doubao':
      return Doubao
    case 'bytedance':
      return Bytedance
    case 'minimax':
      return Minimax
    case 'groq':
      return Groq
    case 'anthropic':
    case 'claude':
      return Anthropic
    case 'wenxin':
      return Wenxin
    case 'baidu':
      return Baidu
    case 'yuanbao':
      return Yuanbao
    case 'sensetime':
      return Sensetime
    case 'xinghuo':
      return Xinghuo
    case 'metaso':
      return Metaso
    case 'poe':
      return Poe
    case 'perplexity':
      return Perplexity
    case 'devv':
      return Devv
    case 'tng':
      return Tng
    case 'felo':
      return Felo
    case 'duck':
      return Duck
    case 'namiai':
      return NamiAi
    case 'thinkany':
      return ThinkAny
    case 'githubcopilot':
      return GithubCopilot
    case 'genspark':
      return Genspark
    case 'grok':
      return Grok
    case 'twitter':
      return Twitter
    case 'flowith':
      return Flowith
    case 'mintop3':
    case '3mintop':
      return MinTop3
    case 'aistudio':
      return AiStudio
    case 'xiaoyi':
      return Xiaoyi
    case 'notebooklm':
      return Notebooklm
    case 'coze':
      return Coze
    case 'dify':
      return Dify
    case 'lingxi':
      return Lingxi
    case 'mistral':
      return Mistral
    case 'abacus':
      return Abacus
    case 'lambda':
      return Lambda
    case 'monica':
      return Monica
    case 'zhida':
      return Zhida
    case 'zai':
      return ZAi
    case 'n8n':
      return N8n
    case 'you':
      return You
    case 'longcat':
      return Longcat
    case 'bolt':
      return BoltNew
    case 'huggingface':
      return Huggingface
    default:
      return undefined
  }
}
