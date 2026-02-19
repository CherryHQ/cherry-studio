import { PROVIDER_ICON_CATALOG, resolveProviderIcon } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import ApplicationLogo from '@renderer/assets/images/apps/application.png?url'
import type { MinAppType } from '@renderer/types'

const logger = loggerService.withContext('Config:minapps')

// 加载自定义小应用
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
      logo: app.logo && app.logo !== '' ? app.logo : ApplicationLogo,
      addTime: app.addTime || now
    }))
  } catch (error) {
    logger.error('Failed to load custom mini apps:', error as Error)
    return []
  }
}

// 初始化默认小应用
const ORIGIN_DEFAULT_MIN_APPS: MinAppType[] = [
  {
    id: 'openai',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    logo: resolveProviderIcon('openai')
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    logo: resolveProviderIcon('gemini')
  },
  {
    id: 'silicon',
    name: 'SiliconFlow',
    url: 'https://cloud.siliconflow.cn/playground/chat',
    logo: resolveProviderIcon('silicon')
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    logo: resolveProviderIcon('deepseek')
  },
  {
    id: 'yi',
    name: 'Wanzhi',
    nameKey: 'minapps.wanzhi',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://www.wanzhi.com/',
    logo: resolveProviderIcon('yi')
  },
  {
    id: 'zhipu',
    name: 'ChatGLM',
    nameKey: 'minapps.chatglm',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://chatglm.cn/main/alltoolsdetail',
    logo: resolveProviderIcon('zhipu')
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://kimi.moonshot.cn/',
    logo: resolveProviderIcon('moonshot')
  },
  {
    id: 'baichuan',
    name: 'Baichuan',
    nameKey: 'minapps.baichuan',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://ying.baichuan-ai.com/chat',
    logo: resolveProviderIcon('baichuan')
  },
  {
    id: 'dashscope',
    name: 'Qwen',
    nameKey: 'minapps.qwen',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://www.qianwen.com',
    logo: PROVIDER_ICON_CATALOG.qwen
  },
  {
    id: 'stepfun',
    name: 'Stepfun',
    nameKey: 'minapps.stepfun',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://stepfun.com',
    logo: resolveProviderIcon('stepfun')
  },
  {
    id: 'doubao',
    name: 'Doubao',
    nameKey: 'minapps.doubao',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://www.doubao.com/chat/',
    logo: PROVIDER_ICON_CATALOG.doubao
  },
  {
    id: 'cici',
    name: 'Dola',
    url: 'https://www.dola.com/chat/',
    logo: PROVIDER_ICON_CATALOG.dola
  },
  {
    id: 'minimax',
    name: 'Hailuo',
    nameKey: 'minapps.hailuo',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://chat.minimaxi.com/',
    logo: resolveProviderIcon('minimax')
  },
  {
    id: 'groq',
    name: 'Groq',
    url: 'https://chat.groq.com/',
    logo: resolveProviderIcon('groq')
  },
  {
    id: 'anthropic',
    name: 'Claude',
    url: 'https://claude.ai/',
    logo: resolveProviderIcon('anthropic')
  },
  {
    id: 'google',
    name: 'Google',
    url: 'https://google.com/',
    logo: PROVIDER_ICON_CATALOG.google
  },
  {
    id: 'baidu-ai-chat',
    name: 'Wenxin',
    nameKey: 'minapps.wenxin',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.wenxin,
    url: 'https://yiyan.baidu.com/'
  },
  {
    id: 'baidu-ai-search',
    name: 'Baidu AI Search',
    nameKey: 'minapps.baidu-ai-search',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.baidu,
    url: 'https://chat.baidu.com/'
  },
  {
    id: 'tencent-yuanbao',
    name: 'Tencent Yuanbao',
    nameKey: 'minapps.tencent-yuanbao',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.yuanbao,
    url: 'https://yuanbao.tencent.com/chat'
  },
  {
    id: 'sensetime-chat',
    name: 'Sensechat',
    nameKey: 'minapps.sensechat',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.sensetime,
    url: 'https://chat.sensetime.com/wb/chat'
  },
  {
    id: 'spark-desk',
    name: 'SparkDesk',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.xinghuo,
    url: 'https://xinghuo.xfyun.cn/desk'
  },
  {
    id: 'metaso',
    name: 'Metaso',
    nameKey: 'minapps.metaso',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.metaso,
    url: 'https://metaso.cn/'
  },
  {
    id: 'poe',
    name: 'Poe',
    logo: resolveProviderIcon('poe'),
    url: 'https://poe.com'
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    logo: resolveProviderIcon('perplexity'),
    url: 'https://www.perplexity.ai/'
  },
  {
    id: 'devv',
    name: 'DEVV_',
    logo: PROVIDER_ICON_CATALOG.devv,
    url: 'https://devv.ai/'
  },
  {
    id: 'tiangong-ai',
    name: 'Tiangong AI',
    nameKey: 'minapps.tiangong-ai',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.skywork,
    url: 'https://www.tiangong.cn/'
  },
  {
    id: 'Felo',
    name: 'Felo',
    logo: PROVIDER_ICON_CATALOG.felo,
    url: 'https://felo.ai/'
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    logo: PROVIDER_ICON_CATALOG.duck,
    url: 'https://duck.ai'
  },
  {
    id: 'bolt',
    name: 'bolt',
    logo: PROVIDER_ICON_CATALOG.boltNew,
    url: 'https://bolt.new/'
  },
  {
    id: 'nm',
    name: 'Nami AI',
    nameKey: 'minapps.nami-ai',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.namiAi,
    url: 'https://bot.n.cn/'
  },
  {
    id: 'thinkany',
    name: 'ThinkAny',
    logo: PROVIDER_ICON_CATALOG.thinkAny,
    url: 'https://thinkany.ai/',
    bodered: true,
    style: {
      padding: 5
    }
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    logo: PROVIDER_ICON_CATALOG.github,
    url: 'https://github.com/copilot'
  },
  {
    id: 'genspark',
    name: 'Genspark',
    logo: PROVIDER_ICON_CATALOG.genspark,
    url: 'https://www.genspark.ai/'
  },
  {
    id: 'grok',
    name: 'Grok',
    logo: resolveProviderIcon('grok'),
    url: 'https://grok.com'
  },
  {
    id: 'grok-x',
    name: 'Grok / X',
    logo: PROVIDER_ICON_CATALOG.twitter,
    url: 'https://x.com/i/grok'
  },
  {
    id: 'qwenlm',
    name: 'QwenChat',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.qwen,
    url: 'https://chat.qwen.ai'
  },
  {
    id: 'flowith',
    name: 'Flowith',
    logo: PROVIDER_ICON_CATALOG.flowith,
    url: 'https://www.flowith.io/'
  },
  {
    id: '3mintop',
    name: '3MinTop',
    logo: PROVIDER_ICON_CATALOG['3minTop'],
    url: 'https://3min.top'
  },
  {
    id: 'aistudio',
    name: 'AI Studio',
    logo: PROVIDER_ICON_CATALOG.aiStudio,
    url: 'https://aistudio.google.com/'
  },
  {
    id: 'xiaoyi',
    name: 'Xiaoyi',
    nameKey: 'minapps.xiaoyi',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.xiaoyi,
    url: 'https://xiaoyi.huawei.com/chat/'
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM',
    logo: PROVIDER_ICON_CATALOG.notebooklm,
    url: 'https://notebooklm.google.com/'
  },
  {
    id: 'coze',
    name: 'Coze',
    logo: PROVIDER_ICON_CATALOG.coze,
    url: 'https://www.coze.com/space'
  },
  {
    id: 'dify',
    name: 'Dify',
    logo: PROVIDER_ICON_CATALOG.dify,
    url: 'https://cloud.dify.ai/apps'
  },
  {
    id: 'wpslingxi',
    name: 'WPS AI',
    nameKey: 'minapps.wps-copilot',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.lingxi,
    url: 'https://copilot.wps.cn/'
  },
  {
    id: 'lechat',
    name: 'LeChat',
    logo: resolveProviderIcon('mistral'),
    url: 'https://chat.mistral.ai/chat'
  },
  {
    id: 'abacus',
    name: 'Abacus',
    logo: PROVIDER_ICON_CATALOG.abacus,
    url: 'https://apps.abacus.ai/chatllm'
  },
  {
    id: 'lambdachat',
    name: 'Lambda Chat',
    logo: PROVIDER_ICON_CATALOG.lambda,
    url: 'https://lambda.chat/',
    bodered: true
  },
  {
    id: 'monica',
    name: 'Monica',
    logo: PROVIDER_ICON_CATALOG.monica,
    url: 'https://monica.im/home/'
  },
  {
    id: 'you',
    name: 'You',
    logo: PROVIDER_ICON_CATALOG.you,
    url: 'https://you.com/'
  },
  {
    id: 'zhihu',
    name: 'Zhihu Zhida',
    nameKey: 'minapps.zhihu',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.zhida,
    url: 'https://zhida.zhihu.com/'
  },
  {
    id: 'dangbei',
    name: 'Dangbei AI',
    nameKey: 'minapps.dangbei',
    locales: ['zh-CN', 'zh-TW'],
    logo: PROVIDER_ICON_CATALOG.dangbei,
    url: 'https://ai.dangbei.com/'
  },
  {
    id: `zai`,
    name: `Z.ai`,
    logo: PROVIDER_ICON_CATALOG.zAi,
    url: `https://chat.z.ai/`
  },
  {
    id: 'n8n',
    name: 'n8n',
    logo: PROVIDER_ICON_CATALOG.n8n,
    url: 'https://app.n8n.cloud/'
  },
  {
    id: 'longcat',
    name: 'LongCat',
    locales: ['zh-CN', 'zh-TW'],
    logo: resolveProviderIcon('longcat'),
    url: 'https://longcat.chat/'
  },
  {
    id: 'ling',
    name: 'Ant Ling',
    nameKey: 'minapps.ant-ling',
    locales: ['zh-CN', 'zh-TW'],
    url: 'https://ling.tbox.cn/chat',
    logo: resolveProviderIcon('ling'),
    bodered: true,
    style: {
      padding: 6
    }
  },
  {
    id: 'huggingchat',
    name: 'HuggingChat',
    url: 'https://huggingface.co/chat/',
    logo: PROVIDER_ICON_CATALOG.huggingface
  }
]

// All mini apps: built-in defaults + custom apps loaded from user config
let allMinApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]

function updateAllMinApps(apps: MinAppType[]) {
  allMinApps = apps
}

export { allMinApps, loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateAllMinApps }
