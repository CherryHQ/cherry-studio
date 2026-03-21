// [v2] TODO: The legacy app/model/provider PNG/WebP logos were removed by the icon-system
// overhaul (#12858). The imports below are a stop-gap to keep tests green �?each mini-app
// now receives a CompoundIcon from @cherrystudio/ui/icons instead of a deleted image URL.
// A proper design should decouple mini-app icon resolution (e.g. a dedicated registry or
// a `resolveMinAppIcon` helper) rather than hard-coding CompoundIcon references here.
import { loggerService } from '@logger'
import type { MinAppType } from '@renderer/types'

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

// 初始化默认小程序
const ORIGIN_DEFAULT_MIN_APPS: MinAppType[] = [
  {
    id: 'openai',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    logo: 'openai',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    logo: 'gemini',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'silicon',
    name: 'SiliconFlow',
    url: 'https://cloud.siliconflow.cn/playground/chat',
    logo: 'silicon',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    logo: 'deepseek',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'yi',
    name: 'Wanzhi',
    nameKey: 'minapps.wanzhi',
    url: 'https://www.wanzhi.com/',
    logo: 'zeroone',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'zhipu',
    name: 'ChatGLM',
    nameKey: 'minapps.chatglm',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    logo: 'zhipu',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    logo: 'kimi',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'baichuan',
    name: 'Baichuan',
    nameKey: 'minapps.baichuan',
    url: 'https://ying.baichuan-ai.com/chat',
    logo: 'baichuan',
    supportedRegions: ['CN']
  },
  {
    id: 'dashscope',
    name: 'Qwen',
    nameKey: 'minapps.qwen',
    url: 'https://www.qianwen.com',
    logo: 'qwen',
    supportedRegions: ['CN']
  },
  {
    id: 'stepfun',
    name: 'Stepfun',
    nameKey: 'minapps.stepfun',
    url: 'https://stepfun.com',
    logo: 'step',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'doubao',
    name: 'Doubao',
    nameKey: 'minapps.doubao',
    url: 'https://www.doubao.com/chat/',
    logo: 'doubao',
    supportedRegions: ['CN']
  },
  {
    id: 'cici',
    name: 'Cici',
    url: 'https://www.cici.com/chat/',
    logo: 'bytedance',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'hailuo',
    name: 'Hailuo',
    nameKey: 'minapps.hailuo',
    url: 'https://hailuoai.com/',
    logo: 'hailuo',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'minimax-agent',
    name: 'Minimax Agent',
    nameKey: 'minapps.minimax-agent',
    url: 'https://agent.minimaxi.com/',
    logo: 'minimax',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'minimax-agent-global',
    name: 'Minimax Agent',
    nameKey: 'minapps.minimax-global',
    url: 'https://agent.minimax.io/',
    logo: 'minimax',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'ima',
    name: 'ima',
    nameKey: 'minapps.ima',
    url: 'https://ima.qq.com/',
    logo: 'ima',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'groq',
    name: 'Groq',
    url: 'https://chat.groq.com/',
    logo: 'groq',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'anthropic',
    name: 'Claude',
    url: 'https://claude.ai/',
    logo: 'claude',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'google',
    name: 'Google',
    url: 'https://google.com/',
    logo: 'google',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'baidu-ai-chat',
    name: 'Wenxin',
    nameKey: 'minapps.wenxin',
    logo: 'wenxin',
    url: 'https://yiyan.baidu.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'baidu-ai-search',
    name: 'Baidu AI Search',
    nameKey: 'minapps.baidu-ai-search',
    logo: 'baidu',
    url: 'https://chat.baidu.com/',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN']
  },
  {
    id: 'tencent-yuanbao',
    name: 'Tencent Yuanbao',
    nameKey: 'minapps.tencent-yuanbao',
    logo: 'yuanbao',
    url: 'https://yuanbao.tencent.com/chat',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'sensetime-chat',
    name: 'Sensechat',
    nameKey: 'minapps.sensechat',
    logo: 'sensetime',
    url: 'https://chat.sensetime.com/wb/chat',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'spark-desk',
    name: 'SparkDesk',
    logo: 'xinghuo',
    url: 'https://xinghuo.xfyun.cn/desk',
    supportedRegions: ['CN']
  },
  {
    id: 'metaso',
    name: 'Metaso',
    nameKey: 'minapps.metaso',
    logo: 'metaso',
    url: 'https://metaso.cn/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'poe',
    name: 'Poe',
    logo: 'poe',
    url: 'https://poe.com',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    logo: 'perplexity',
    url: 'https://www.perplexity.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'devv',
    name: 'DEVV_',
    logo: 'devv',
    url: 'https://devv.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'tiangong-ai',
    name: 'Tiangong AI',
    nameKey: 'minapps.tiangong-ai',
    logo: 'tng',
    url: 'https://www.tiangong.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'Felo',
    name: 'Felo',
    logo: 'felo',
    url: 'https://felo.ai/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    logo: 'duck',
    url: 'https://duck.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'bolt',
    name: 'bolt',
    logo: 'bolt',
    url: 'https://bolt.new/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'nm',
    name: 'Nami AI',
    nameKey: 'minapps.nami-ai',
    logo: 'namiai',
    url: 'https://bot.n.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'thinkany',
    name: 'ThinkAny',
    logo: 'thinkany',
    url: 'https://thinkany.ai/',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    logo: 'githubcopilot',
    url: 'https://github.com/copilot',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'genspark',
    name: 'Genspark',
    logo: 'genspark',
    url: 'https://www.genspark.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'grok',
    name: 'Grok',
    logo: 'grok',
    url: 'https://grok.com',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'grok-x',
    name: 'Grok / X',
    logo: 'twitter',
    url: 'https://x.com/i/grok',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'qwenlm',
    name: 'QwenChat',
    logo: 'qwen',
    url: 'https://chat.qwen.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'flowith',
    name: 'Flowith',
    logo: 'flowith',
    url: 'https://www.flowith.io/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: '3mintop',
    name: '3MinTop',
    logo: 'mintop3',
    url: 'https://3min.top',
    bordered: false,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'aistudio',
    name: 'AI Studio',
    logo: 'aistudio',
    url: 'https://aistudio.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'xiaoyi',
    name: 'Xiaoyi',
    nameKey: 'minapps.xiaoyi',
    logo: 'xiaoyi',
    url: 'https://xiaoyi.huawei.com/chat/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM',
    logo: 'notebooklm',
    url: 'https://notebooklm.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'coze',
    name: 'Coze',
    logo: 'coze',
    url: 'https://www.coze.com/space',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'dify',
    name: 'Dify',
    logo: 'dify',
    url: 'https://cloud.dify.ai/apps',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'wpslingxi',
    name: 'WPS AI',
    nameKey: 'minapps.wps-copilot',
    logo: 'lingxi',
    url: 'https://copilot.wps.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'lechat',
    name: 'LeChat',
    logo: 'mistral',
    url: 'https://chat.mistral.ai/chat',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'abacus',
    name: 'Abacus',
    logo: 'abacus',
    url: 'https://apps.abacus.ai/chatllm',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'lambdachat',
    name: 'Lambda Chat',
    logo: 'lambda',
    url: 'https://lambda.chat/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'monica',
    name: 'Monica',
    logo: 'monica',
    url: 'https://monica.im/home/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'you',
    name: 'You',
    logo: 'you',
    url: 'https://you.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'zhihu',
    name: 'Zhihu Zhida',
    nameKey: 'minapps.zhihu',
    logo: 'zhida',
    url: 'https://zhida.zhihu.com/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'dangbei',
    name: 'Dangbei AI',
    nameKey: 'minapps.dangbei',
    logo: 'dangbei',
    url: 'https://ai.dangbei.com/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: `zai`,
    name: `Z.ai`,
    logo: 'zai',
    url: `https://chat.z.ai/`,
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'n8n',
    name: 'n8n',
    logo: 'n8n',
    url: 'https://app.n8n.cloud/',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'longcat',
    name: 'LongCat',
    logo: 'longcat',
    url: 'https://longcat.chat/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'ling',
    name: 'Ant Ling',
    nameKey: 'minapps.ant-ling',
    url: 'https://ling.tbox.cn/chat',
    logo: 'ling',
    bordered: true,
    style: {
      padding: 6
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'huggingchat',
    name: 'HuggingChat',
    url: 'https://huggingface.co/chat/',
    logo: 'huggingface',
    bordered: true,
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
