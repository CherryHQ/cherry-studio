import { MODEL_ICON_CATALOG, PROVIDER_ICON_CATALOG, resolveProviderIcon } from '@cherrystudio/ui/icons'
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
      addTime: app.addTime || now,
      supportedRegions: ['CN', 'Global'] // Custom mini apps should always be visible for all regions
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
    logo: resolveProviderIcon('openai'),
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    logo: MODEL_ICON_CATALOG.gemini,
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'silicon',
    name: 'SiliconFlow',
    url: 'https://cloud.siliconflow.cn/playground/chat',
    logo: resolveProviderIcon('silicon'),
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    logo: resolveProviderIcon('deepseek'),
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'yi',
    name: 'Wanzhi',
    nameKey: 'minapps.wanzhi',
    url: 'https://www.wanzhi.com/',
    logo: resolveProviderIcon('yi'),
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'zhipu',
    name: 'ChatGLM',
    nameKey: 'minapps.chatglm',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    logo: resolveProviderIcon('zhipu'),
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    logo: resolveProviderIcon('moonshot'),
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'baichuan',
    name: 'Baichuan',
    nameKey: 'minapps.baichuan',
    url: 'https://ying.baichuan-ai.com/chat',
    logo: resolveProviderIcon('baichuan'),
    supportedRegions: ['CN']
  },
  {
    id: 'dashscope',
    name: 'Qwen',
    nameKey: 'minapps.qwen',
    url: 'https://www.qianwen.com',
    logo: PROVIDER_ICON_CATALOG.qwen,
    supportedRegions: ['CN']
  },
  {
    id: 'stepfun',
    name: 'Stepfun',
    nameKey: 'minapps.stepfun',
    url: 'https://stepfun.com',
    logo: resolveProviderIcon('stepfun'),
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'doubao',
    name: 'Doubao',
    nameKey: 'minapps.doubao',
    url: 'https://www.doubao.com/chat/',
    logo: PROVIDER_ICON_CATALOG.doubao,
    supportedRegions: ['CN']
  },
  {
    id: 'cici',
    name: 'Cici',
    url: 'https://www.cici.com/chat/',
    logo: PROVIDER_ICON_CATALOG.dola,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'minimax',
    name: 'Hailuo',
    nameKey: 'minapps.hailuo',
    url: 'https://chat.minimaxi.com/',
    logo: resolveProviderIcon('minimax'),
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'groq',
    name: 'Groq',
    url: 'https://chat.groq.com/',
    logo: resolveProviderIcon('groq'),
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'anthropic',
    name: 'Claude',
    url: 'https://claude.ai/',
    logo: resolveProviderIcon('anthropic'),
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'google',
    name: 'Google',
    url: 'https://google.com/',
    logo: PROVIDER_ICON_CATALOG.google,
    bodered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'baidu-ai-chat',
    name: 'Wenxin',
    nameKey: 'minapps.wenxin',
    logo: PROVIDER_ICON_CATALOG.wenxin,
    url: 'https://yiyan.baidu.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'baidu-ai-search',
    name: 'Baidu AI Search',
    nameKey: 'minapps.baidu-ai-search',
    logo: PROVIDER_ICON_CATALOG.baidu,
    url: 'https://chat.baidu.com/',
    bodered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN']
  },
  {
    id: 'tencent-yuanbao',
    name: 'Tencent Yuanbao',
    nameKey: 'minapps.tencent-yuanbao',
    logo: PROVIDER_ICON_CATALOG.yuanbao,
    url: 'https://yuanbao.tencent.com/chat',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'sensetime-chat',
    name: 'Sensechat',
    nameKey: 'minapps.sensechat',
    logo: PROVIDER_ICON_CATALOG.sensetime,
    url: 'https://chat.sensetime.com/wb/chat',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'spark-desk',
    name: 'SparkDesk',
    logo: PROVIDER_ICON_CATALOG.xinghuo,
    url: 'https://xinghuo.xfyun.cn/desk',
    supportedRegions: ['CN']
  },
  {
    id: 'metaso',
    name: 'Metaso',
    nameKey: 'minapps.metaso',
    logo: PROVIDER_ICON_CATALOG.metaso,
    url: 'https://metaso.cn/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'poe',
    name: 'Poe',
    logo: resolveProviderIcon('poe'),
    url: 'https://poe.com',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    logo: resolveProviderIcon('perplexity'),
    url: 'https://www.perplexity.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'devv',
    name: 'DEVV_',
    logo: PROVIDER_ICON_CATALOG.devv,
    url: 'https://devv.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'tiangong-ai',
    name: 'Tiangong AI',
    nameKey: 'minapps.tiangong-ai',
    logo: PROVIDER_ICON_CATALOG.skywork,
    url: 'https://www.tiangong.cn/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'Felo',
    name: 'Felo',
    logo: PROVIDER_ICON_CATALOG.felo,
    url: 'https://felo.ai/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    logo: PROVIDER_ICON_CATALOG.duck,
    url: 'https://duck.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'bolt',
    name: 'bolt',
    logo: PROVIDER_ICON_CATALOG.boltNew,
    url: 'https://bolt.new/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'nm',
    name: 'Nami AI',
    nameKey: 'minapps.nami-ai',
    logo: PROVIDER_ICON_CATALOG.namiAi,
    url: 'https://bot.n.cn/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'thinkany',
    name: 'ThinkAny',
    logo: PROVIDER_ICON_CATALOG.thinkAny,
    url: 'https://thinkany.ai/',
    bodered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    logo: PROVIDER_ICON_CATALOG.github,
    url: 'https://github.com/copilot',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'genspark',
    name: 'Genspark',
    logo: PROVIDER_ICON_CATALOG.genspark,
    url: 'https://www.genspark.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'grok',
    name: 'Grok',
    logo: resolveProviderIcon('grok'),
    url: 'https://grok.com',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'grok-x',
    name: 'Grok / X',
    logo: PROVIDER_ICON_CATALOG.twitter,
    url: 'https://x.com/i/grok',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'qwenlm',
    name: 'QwenChat',
    logo: PROVIDER_ICON_CATALOG.qwen,
    url: 'https://chat.qwen.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'flowith',
    name: 'Flowith',
    logo: PROVIDER_ICON_CATALOG.flowith,
    url: 'https://www.flowith.io/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: '3mintop',
    name: '3MinTop',
    logo: PROVIDER_ICON_CATALOG['3minTop'],
    url: 'https://3min.top',
    bodered: false,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'aistudio',
    name: 'AI Studio',
    logo: PROVIDER_ICON_CATALOG.aiStudio,
    url: 'https://aistudio.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'xiaoyi',
    name: 'Xiaoyi',
    nameKey: 'minapps.xiaoyi',
    logo: PROVIDER_ICON_CATALOG.xiaoyi,
    url: 'https://xiaoyi.huawei.com/chat/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM',
    logo: PROVIDER_ICON_CATALOG.notebooklm,
    url: 'https://notebooklm.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'coze',
    name: 'Coze',
    logo: PROVIDER_ICON_CATALOG.coze,
    url: 'https://www.coze.com/space',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'dify',
    name: 'Dify',
    logo: PROVIDER_ICON_CATALOG.dify,
    url: 'https://cloud.dify.ai/apps',
    bodered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'wpslingxi',
    name: 'WPS AI',
    nameKey: 'minapps.wps-copilot',
    logo: PROVIDER_ICON_CATALOG.lingxi,
    url: 'https://copilot.wps.cn/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'lechat',
    name: 'LeChat',
    logo: resolveProviderIcon('mistral'),
    url: 'https://chat.mistral.ai/chat',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'abacus',
    name: 'Abacus',
    logo: PROVIDER_ICON_CATALOG.abacus,
    url: 'https://apps.abacus.ai/chatllm',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'lambdachat',
    name: 'Lambda Chat',
    logo: PROVIDER_ICON_CATALOG.lambda,
    url: 'https://lambda.chat/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'monica',
    name: 'Monica',
    logo: PROVIDER_ICON_CATALOG.monica,
    url: 'https://monica.im/home/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'you',
    name: 'You',
    logo: PROVIDER_ICON_CATALOG.you,
    url: 'https://you.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'zhihu',
    name: 'Zhihu Zhida',
    nameKey: 'minapps.zhihu',
    logo: PROVIDER_ICON_CATALOG.zhida,
    url: 'https://zhida.zhihu.com/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'dangbei',
    name: 'Dangbei AI',
    nameKey: 'minapps.dangbei',
    logo: PROVIDER_ICON_CATALOG.dangbei,
    url: 'https://ai.dangbei.com/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: `zai`,
    name: `Z.ai`,
    logo: PROVIDER_ICON_CATALOG.zAi,
    url: `https://chat.z.ai/`,
    bodered: true,
    style: {
      padding: 10
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'n8n',
    name: 'n8n',
    logo: PROVIDER_ICON_CATALOG.n8n,
    url: 'https://app.n8n.cloud/',
    bodered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'longcat',
    name: 'LongCat',
    logo: resolveProviderIcon('longcat'),
    url: 'https://longcat.chat/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'ling',
    name: 'Ant Ling',
    nameKey: 'minapps.ant-ling',
    url: 'https://ling.tbox.cn/chat',
    logo: resolveProviderIcon('ling'),
    bodered: true,
    style: {
      padding: 6
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'huggingchat',
    name: 'HuggingChat',
    url: 'https://huggingface.co/chat/',
    logo: PROVIDER_ICON_CATALOG.huggingface,
    bodered: true,
    style: {
      padding: 6
    },
    supportedRegions: ['CN', 'Global']
  }
]

// All mini apps: built-in defaults + custom apps loaded from user config
let allMinApps = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]

function updateAllMinApps(apps: MinAppType[]) {
  allMinApps = apps
}

export { allMinApps, loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateAllMinApps }
