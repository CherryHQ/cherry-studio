import { loggerService } from '@logger'
import ThreeMinTopAppLogo from '@renderer/assets/images/apps/3mintop.png?url'
import AbacusLogo from '@renderer/assets/images/apps/abacus.webp?url'
import AIStudioLogo from '@renderer/assets/images/apps/aistudio.svg?url'
import ApplicationLogo from '@renderer/assets/images/apps/application.png?url'
import BaiduAiAppLogo from '@renderer/assets/images/apps/baidu-ai.png?url'
import BaiduAiSearchLogo from '@renderer/assets/images/apps/baidu-ai-search.webp?url'
import BaicuanAppLogo from '@renderer/assets/images/apps/baixiaoying.webp?url'
import BoltAppLogo from '@renderer/assets/images/apps/bolt.svg?url'
import CiciAppLogo from '@renderer/assets/images/apps/cici.webp?url'
import CozeAppLogo from '@renderer/assets/images/apps/coze.webp?url'
import DangbeiLogo from '@renderer/assets/images/apps/dangbei.jpg?url'
import DevvAppLogo from '@renderer/assets/images/apps/devv.png?url'
import DifyAppLogo from '@renderer/assets/images/apps/dify.svg?url'
import DoubaoAppLogo from '@renderer/assets/images/apps/doubao.png?url'
import DuckDuckGoAppLogo from '@renderer/assets/images/apps/duckduckgo.webp?url'
import FeloAppLogo from '@renderer/assets/images/apps/felo.png?url'
import FlowithAppLogo from '@renderer/assets/images/apps/flowith.svg?url'
import GeminiAppLogo from '@renderer/assets/images/apps/gemini.png?url'
import GensparkLogo from '@renderer/assets/images/apps/genspark.jpg?url'
import GithubCopilotLogo from '@renderer/assets/images/apps/github-copilot.webp?url'
import GoogleAppLogo from '@renderer/assets/images/apps/google.svg?url'
import GrokAppLogo from '@renderer/assets/images/apps/grok.png?url'
import GrokXAppLogo from '@renderer/assets/images/apps/grok-x.png?url'
import HikaLogo from '@renderer/assets/images/apps/hika.webp?url'
import HuggingChatLogo from '@renderer/assets/images/apps/huggingchat.svg?url'
import KimiAppLogo from '@renderer/assets/images/apps/kimi.webp?url'
import LambdaChatLogo from '@renderer/assets/images/apps/lambdachat.webp?url'
import LeChatLogo from '@renderer/assets/images/apps/lechat.png?url'
import MetasoAppLogo from '@renderer/assets/images/apps/metaso.webp?url'
import MonicaLogo from '@renderer/assets/images/apps/monica.webp?url'
import n8nLogo from '@renderer/assets/images/apps/n8n.svg?url'
import NamiAiLogo from '@renderer/assets/images/apps/nm.png?url'
import NamiAiSearchLogo from '@renderer/assets/images/apps/nm-search.webp?url'
import NotebookLMAppLogo from '@renderer/assets/images/apps/notebooklm.svg?url'
import PerplexityAppLogo from '@renderer/assets/images/apps/perplexity.webp?url'
import PoeAppLogo from '@renderer/assets/images/apps/poe.webp?url'
import ZhipuProviderLogo from '@renderer/assets/images/apps/qingyan.png?url'
import QwenlmAppLogo from '@renderer/assets/images/apps/qwenlm.webp?url'
import SensetimeAppLogo from '@renderer/assets/images/apps/sensetime.png?url'
import SparkDeskAppLogo from '@renderer/assets/images/apps/sparkdesk.webp?url'
import ThinkAnyLogo from '@renderer/assets/images/apps/thinkany.webp?url'
import TiangongAiLogo from '@renderer/assets/images/apps/tiangong.png?url'
import WanZhiAppLogo from '@renderer/assets/images/apps/wanzhi.jpg?url'
import WPSLingXiLogo from '@renderer/assets/images/apps/wpslingxi.webp?url'
import XiaoYiAppLogo from '@renderer/assets/images/apps/xiaoyi.webp?url'
import YouLogo from '@renderer/assets/images/apps/you.jpg?url'
import TencentYuanbaoAppLogo from '@renderer/assets/images/apps/yuanbao.webp?url'
import YuewenAppLogo from '@renderer/assets/images/apps/yuewen.png?url'
import ZaiAppLogo from '@renderer/assets/images/apps/zai.png?url'
import ZhihuAppLogo from '@renderer/assets/images/apps/zhihu.png?url'
import ClaudeAppLogo from '@renderer/assets/images/models/claude.png?url'
import HailuoModelLogo from '@renderer/assets/images/models/hailuo.png?url'
import QwenModelLogo from '@renderer/assets/images/models/qwen.png?url'
import DeepSeekProviderLogo from '@renderer/assets/images/providers/deepseek.png?url'
import GroqProviderLogo from '@renderer/assets/images/providers/groq.png?url'
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png?url'
import SiliconFlowProviderLogo from '@renderer/assets/images/providers/silicon.png?url'
import { MinAppType } from '@renderer/types'

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
    logo: OpenAiProviderLogo,
    bodered: true
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    logo: GeminiAppLogo
  },
  {
    id: 'silicon',
    name: 'SiliconFlow',
    url: 'https://cloud.siliconflow.cn/playground/chat',
    logo: SiliconFlowProviderLogo
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    logo: DeepSeekProviderLogo
  },
  {
    id: 'yi',
    name: '万知',
    url: 'https://www.wanzhi.com/',
    logo: WanZhiAppLogo,
    bodered: true
  },
  {
    id: 'zhipu',
    name: '智谱清言',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    logo: ZhipuProviderLogo
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    logo: KimiAppLogo
  },
  {
    id: 'baichuan',
    name: '百小应',
    url: 'https://ying.baichuan-ai.com/chat',
    logo: BaicuanAppLogo
  },
  {
    id: 'dashscope',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen/',
    logo: QwenModelLogo
  },
  {
    id: 'stepfun',
    name: '跃问',
    url: 'https://yuewen.cn/chats/new',
    logo: YuewenAppLogo,
    bodered: true
  },
  {
    id: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com/chat/',
    logo: DoubaoAppLogo
  },
  {
    id: 'cici',
    name: 'Cici',
    url: 'https://www.cici.com/chat/',
    logo: CiciAppLogo
  },
  {
    id: 'minimax',
    name: '海螺',
    url: 'https://chat.minimaxi.com/',
    logo: HailuoModelLogo,
    bodered: true
  },
  {
    id: 'groq',
    name: 'Groq',
    url: 'https://chat.groq.com/',
    logo: GroqProviderLogo
  },
  {
    id: 'anthropic',
    name: 'Claude',
    url: 'https://claude.ai/',
    logo: ClaudeAppLogo
  },
  {
    id: 'google',
    name: 'Google',
    url: 'https://google.com/',
    logo: GoogleAppLogo,
    bodered: true,
    style: {
      padding: 5
    }
  },
  {
    id: 'baidu-ai-chat',
    name: '文心一言',
    logo: BaiduAiAppLogo,
    url: 'https://yiyan.baidu.com/'
  },
  {
    id: 'baidu-ai-search',
    name: '百度AI搜索',
    logo: BaiduAiSearchLogo,
    url: 'https://chat.baidu.com/',
    bodered: true,
    style: {
      padding: 5
    }
  },
  {
    id: 'tencent-yuanbao',
    name: '腾讯元宝',
    logo: TencentYuanbaoAppLogo,
    url: 'https://yuanbao.tencent.com/chat',
    bodered: true
  },
  {
    id: 'sensetime-chat',
    name: '商量',
    logo: SensetimeAppLogo,
    url: 'https://chat.sensetime.com/wb/chat',
    bodered: true
  },
  {
    id: 'spark-desk',
    name: 'SparkDesk',
    logo: SparkDeskAppLogo,
    url: 'https://xinghuo.xfyun.cn/desk'
  },
  {
    id: 'metaso',
    name: '秘塔AI搜索',
    logo: MetasoAppLogo,
    url: 'https://metaso.cn/'
  },
  {
    id: 'poe',
    name: 'Poe',
    logo: PoeAppLogo,
    url: 'https://poe.com'
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    logo: PerplexityAppLogo,
    url: 'https://www.perplexity.ai/'
  },
  {
    id: 'devv',
    name: 'DEVV_',
    logo: DevvAppLogo,
    url: 'https://devv.ai/'
  },
  {
    id: 'tiangong-ai',
    name: '天工AI',
    logo: TiangongAiLogo,
    url: 'https://www.tiangong.cn/',
    bodered: true
  },
  {
    id: 'hugging-chat',
    name: 'HuggingChat',
    logo: HuggingChatLogo,
    url: 'https://huggingface.co/chat/',
    bodered: true
  },
  {
    id: 'Felo',
    name: 'Felo',
    logo: FeloAppLogo,
    url: 'https://felo.ai/',
    bodered: true
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    logo: DuckDuckGoAppLogo,
    url: 'https://duck.ai'
  },
  {
    id: 'bolt',
    name: 'bolt',
    logo: BoltAppLogo,
    url: 'https://bolt.new/',
    bodered: true
  },
  {
    id: 'nm',
    name: '纳米AI',
    logo: NamiAiLogo,
    url: 'https://bot.n.cn/',
    bodered: true
  },
  {
    id: 'nm-search',
    name: '纳米AI搜索',
    logo: NamiAiSearchLogo,
    url: 'https://www.n.cn/',
    bodered: true
  },
  {
    id: 'thinkany',
    name: 'ThinkAny',
    logo: ThinkAnyLogo,
    url: 'https://thinkany.ai/',
    bodered: true,
    style: {
      padding: 5
    }
  },
  {
    id: 'hika',
    name: 'Hika',
    logo: HikaLogo,
    url: 'https://hika.fyi/',
    bodered: true
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    logo: GithubCopilotLogo,
    url: 'https://github.com/copilot'
  },
  {
    id: 'genspark',
    name: 'Genspark',
    logo: GensparkLogo,
    url: 'https://www.genspark.ai/'
  },
  {
    id: 'grok',
    name: 'Grok',
    logo: GrokAppLogo,
    url: 'https://grok.com',
    bodered: true
  },
  {
    id: 'grok-x',
    name: 'Grok / X',
    logo: GrokXAppLogo,
    url: 'https://x.com/i/grok',
    bodered: true
  },
  {
    id: 'qwenlm',
    name: 'QwenLM',
    logo: QwenlmAppLogo,
    url: 'https://qwenlm.ai/'
  },
  {
    id: 'flowith',
    name: 'Flowith',
    logo: FlowithAppLogo,
    url: 'https://www.flowith.io/',
    bodered: true
  },
  {
    id: '3mintop',
    name: '3MinTop',
    logo: ThreeMinTopAppLogo,
    url: 'https://3min.top',
    bodered: false
  },
  {
    id: 'aistudio',
    name: 'AI Studio',
    logo: AIStudioLogo,
    url: 'https://aistudio.google.com/'
  },
  {
    id: 'xiaoyi',
    name: '小艺',
    logo: XiaoYiAppLogo,
    url: 'https://xiaoyi.huawei.com/chat/',
    bodered: true
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM',
    logo: NotebookLMAppLogo,
    url: 'https://notebooklm.google.com/'
  },
  {
    id: 'coze',
    name: 'Coze',
    logo: CozeAppLogo,
    url: 'https://www.coze.com/space',
    bodered: true
  },
  {
    id: 'dify',
    name: 'Dify',
    logo: DifyAppLogo,
    url: 'https://cloud.dify.ai/apps',
    bodered: true,
    style: {
      padding: 5
    }
  },
  {
    id: 'wpslingxi',
    name: 'WPS灵犀',
    logo: WPSLingXiLogo,
    url: 'https://copilot.wps.cn/',
    bodered: true
  },
  {
    id: 'lechat',
    name: 'LeChat',
    logo: LeChatLogo,
    url: 'https://chat.mistral.ai/chat',
    bodered: true
  },
  {
    id: 'abacus',
    name: 'Abacus',
    logo: AbacusLogo,
    url: 'https://apps.abacus.ai/chatllm',
    bodered: true
  },
  {
    id: 'lambdachat',
    name: 'Lambda Chat',
    logo: LambdaChatLogo,
    url: 'https://lambda.chat/',
    bodered: true
  },
  {
    id: 'monica',
    name: 'Monica',
    logo: MonicaLogo,
    url: 'https://monica.im/home/',
    bodered: true
  },
  {
    id: 'you',
    name: 'You',
    logo: YouLogo,
    url: 'https://you.com/'
  },
  {
    id: 'zhihu',
    name: '知乎直答',
    logo: ZhihuAppLogo,
    url: 'https://zhida.zhihu.com/',
    bodered: true
  },
  {
    id: 'dangbei',
    name: '当贝AI',
    logo: DangbeiLogo,
    url: 'https://ai.dangbei.com/',
    bodered: true
  },
  {
    id: `zai`,
    name: `Z.ai`,
    logo: ZaiAppLogo,
    url: `https://chat.z.ai/`,
    bodered: true,
    style: {
      padding: 10
    }
  },
  {
    id: 'n8n',
    name: 'n8n',
    logo: n8nLogo,
    url: 'https://app.n8n.cloud/',
    bodered: true,
    style: {
      padding: 5
    }
  }
]

// 加载自定义小应用并合并到默认应用中
let DEFAULT_MIN_APPS = [...ORIGIN_DEFAULT_MIN_APPS, ...(await loadCustomMiniApp())]

function updateDefaultMinApps(param) {
  DEFAULT_MIN_APPS = param
}

export { DEFAULT_MIN_APPS, loadCustomMiniApp, ORIGIN_DEFAULT_MIN_APPS, updateDefaultMinApps }
