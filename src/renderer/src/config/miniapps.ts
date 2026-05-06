// [v2] TODO: The legacy app/model/provider PNG/WebP logos were removed by the icon-system
// overhaul (#12858). The imports below are a stop-gap to keep tests green - each mini-app
// now receives a CompoundIcon from @cherrystudio/ui/icons instead of a deleted image URL.
// A proper design should decouple mini-app icon resolution (e.g. a dedicated registry or
// a `resolveMiniAppIcon` helper) rather than hard-coding CompoundIcon references here.

import type { CompoundIcon } from '@cherrystudio/ui'
import { ModelIcons } from '@cherrystudio/ui/icons'
import {
  Abacus,
  AiStudio,
  Anthropic,
  Application,
  Baichuan,
  Baidu,
  BoltNew,
  Bytedance,
  Coze,
  Dangbei,
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
  Ima,
  Lambda,
  Lingxi,
  Longcat,
  Metaso,
  MinimaxAgent,
  MinTop3,
  Mistral,
  Monica,
  Moonshot,
  N8n,
  NamiAi,
  Notebooklm,
  Openai,
  Openclaw,
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
import { PRESETS_MINI_APPS as SHARED_PRESETS } from '@shared/data/presets/mini-apps'

/**
 * Legacy mini-app entity type used by the deprecated Redux slice and config layer.
 * The v2 MiniApp entity lives in @shared/data/types/miniApp.
 */
export type MiniAppType = {
  id: string
  name: string
  nameKey?: string
  supportedRegions?: string[]
  logo?: string
  url: string
  bordered?: boolean
  background?: string
  style?: Record<string, unknown>
  addTime?: string
  type?: 'Custom' | 'Default'
}

const logger = loggerService.withContext('Config:miniapps')

// Load custom miniapps
const loadCustomMiniApps = async (): Promise<MiniAppType[]> => {
  const FILENAME = 'custom-miniapps.json'
  try {
    let content: string
    try {
      content = await window.api.file.read(FILENAME)
    } catch (error: any) {
      // I6: Only create empty file on ENOENT; for other errors, quarantine and return empty
      if (error?.code === 'ENOENT' || error?.message?.includes('no such file')) {
        content = '[]'
        await window.api.file.writeWithId(FILENAME, content)
      } else {
        logger.error('Failed to read custom mini apps file:', error as Error)
        return []
      }
    }

    const customApps: unknown = JSON.parse(content)
    const now = new Date().toISOString()

    if (!Array.isArray(customApps)) return []

    return (customApps as Partial<MiniAppType>[])
      .filter((app): app is MiniAppType => typeof app.id === 'string')
      .map((app) => ({
        ...app,
        type: 'Custom' as const,
        // Custom apps can use image URLs directly or icon keys
        logo: app.logo && app.logo !== '' ? app.logo : 'application',
        addTime: app.addTime || now,
        supportedRegions: ['CN', 'Global'] as const
      }))
  } catch (error) {
    // JSON parse or other unexpected error — quarantine the broken file so the
    // user can recover their data instead of silently losing all custom apps.
    logger.error('Failed to load custom mini apps, quarantining broken file:', error as Error)
    try {
      const ts = Date.now()
      const brokenName = `${FILENAME}.broken-${ts}`
      // Preserve the corrupt content under the .broken name for user recovery
      const rawContent = await window.api.file.read(FILENAME).catch(() => '')
      if (rawContent) {
        await window.api.file.writeWithId(brokenName, rawContent)
        logger.info(`Quarantined ${FILENAME} as ${brokenName}`)
      }
      // Reset the original file so next load succeeds
      await window.api.file.writeWithId(FILENAME, '[]')
    } catch (quarantineErr) {
      logger.warn('Could not quarantine broken custom miniapps file', quarantineErr as Error)
    }
    return []
  }
}

// I13: Derive renderer preset list from the shared single source of truth
const PRESETS_MINI_APPS: MiniAppType[] = SHARED_PRESETS.map((app) => ({
  id: app.id,
  name: app.name,
  nameKey: app.nameKey,
  url: app.url,
  logo: app.logo,
  bordered: app.bordered,
  background: app.background,
  supportedRegions: app.supportedRegions,
  style: app.style
}))

// All mini apps: built-in defaults + custom apps loaded from user config
const allMiniApps = [...PRESETS_MINI_APPS, ...(await loadCustomMiniApps())]

export { allMiniApps, PRESETS_MINI_APPS }

export function getMiniAppsLogo(LogoId: string | undefined): CompoundIcon | undefined {
  if (!LogoId) {
    return
  }
  switch (LogoId.toLowerCase()) {
    case 'application':
      return Application
    case 'openclaw':
      return Openclaw
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
      return MinimaxAgent
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
    case 'ima':
      return Ima
    case 'dangbei':
      return Dangbei
    case 'hailuo':
      return ModelIcons.Hailuo
    case 'ling':
      return ModelIcons.Ling
    default:
      return undefined
  }
}
