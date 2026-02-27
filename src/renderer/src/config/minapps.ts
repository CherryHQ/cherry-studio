import { loggerService } from '@logger'
import ThreeMinTopAppLogo from '@renderer/assets/images/apps/3mintop.png?url'
import AbacusLogo from '@renderer/assets/images/apps/abacus.webp?url'
import AIStudioLogo from '@renderer/assets/images/apps/aistudio.png?url'
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
import HuggingChatLogo from '@renderer/assets/images/apps/huggingchat.svg?url'
import KimiAppLogo from '@renderer/assets/images/apps/kimi.webp?url'
import LambdaChatLogo from '@renderer/assets/images/apps/lambdachat.webp?url'
import LeChatLogo from '@renderer/assets/images/apps/lechat.png?url'
import LingAppLogo from '@renderer/assets/images/apps/ling.png?url'
import LongCatAppLogo from '@renderer/assets/images/apps/longcat.svg?url'
import MetasoAppLogo from '@renderer/assets/images/apps/metaso.webp?url'
import MonicaLogo from '@renderer/assets/images/apps/monica.webp?url'
import n8nLogo from '@renderer/assets/images/apps/n8n.svg?url'
import NamiAiLogo from '@renderer/assets/images/apps/nm.png?url'
import NotebookLMAppLogo from '@renderer/assets/images/apps/notebooklm.svg?url'
import PerplexityAppLogo from '@renderer/assets/images/apps/perplexity.webp?url'
import PoeAppLogo from '@renderer/assets/images/apps/poe.webp?url'
import QwenlmAppLogo from '@renderer/assets/images/apps/qwenlm.webp?url'
import SensetimeAppLogo from '@renderer/assets/images/apps/sensetime.png?url'
import SparkDeskAppLogo from '@renderer/assets/images/apps/sparkdesk.webp?url'
import StepfunAppLogo from '@renderer/assets/images/apps/stepfun.png?url'
import ThinkAnyLogo from '@renderer/assets/images/apps/thinkany.webp?url'
import TiangongAiLogo from '@renderer/assets/images/apps/tiangong.png?url'
import WanZhiAppLogo from '@renderer/assets/images/apps/wanzhi.jpg?url'
import WPSLingXiLogo from '@renderer/assets/images/apps/wpslingxi.webp?url'
import XiaoYiAppLogo from '@renderer/assets/images/apps/xiaoyi.webp?url'
import YouLogo from '@renderer/assets/images/apps/you.jpg?url'
import TencentYuanbaoAppLogo from '@renderer/assets/images/apps/yuanbao.webp?url'
import ZaiAppLogo from '@renderer/assets/images/apps/zai.png?url'
import ZhihuAppLogo from '@renderer/assets/images/apps/zhihu.png?url'
import ClaudeAppLogo from '@renderer/assets/images/models/claude.png?url'
import HailuoModelLogo from '@renderer/assets/images/models/hailuo.png?url'
import QwenModelLogo from '@renderer/assets/images/models/qwen.png?url'
import DeepSeekProviderLogo from '@renderer/assets/images/providers/deepseek.png?url'
import GroqProviderLogo from '@renderer/assets/images/providers/groq.png?url'
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png?url'
import SiliconFlowProviderLogo from '@renderer/assets/images/providers/silicon.png?url'
import ZhipuProviderLogo from '@renderer/assets/images/providers/zhipu.png?url'
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
    logo: OpenAiProviderLogo,
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    logo: GeminiAppLogo,
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'silicon',
    name: 'SiliconFlow',
    url: 'https://cloud.siliconflow.cn/playground/chat',
    logo: SiliconFlowProviderLogo,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    logo: DeepSeekProviderLogo,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'yi',
    name: 'Wanzhi',
    nameKey: 'minapps.wanzhi',
    url: 'https://www.wanzhi.com/',
    logo: WanZhiAppLogo,
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'zhipu',
    name: 'ChatGLM',
    nameKey: 'minapps.chatglm',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    logo: ZhipuProviderLogo,
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    logo: KimiAppLogo,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'baichuan',
    name: 'Baichuan',
    nameKey: 'minapps.baichuan',
    url: 'https://ying.baichuan-ai.com/chat',
    logo: BaicuanAppLogo,
    supportedRegions: ['CN']
  },
  {
    id: 'dashscope',
    name: 'Qwen',
    nameKey: 'minapps.qwen',
    url: 'https://www.qianwen.com',
    logo: QwenModelLogo,
    supportedRegions: ['CN']
  },
  {
    id: 'stepfun',
    name: 'Stepfun',
    nameKey: 'minapps.stepfun',
    url: 'https://stepfun.com',
    logo: StepfunAppLogo,
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'doubao',
    name: 'Doubao',
    nameKey: 'minapps.doubao',
    url: 'https://www.doubao.com/chat/',
    logo: DoubaoAppLogo,
    supportedRegions: ['CN']
  },
  {
    id: 'cici',
    name: 'Cici',
    url: 'https://www.cici.com/chat/',
    logo: CiciAppLogo,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'minimax',
    name: 'Hailuo',
    nameKey: 'minapps.hailuo',
    url: 'https://chat.minimaxi.com/',
    logo: HailuoModelLogo,
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'groq',
    name: 'Groq',
    url: 'https://chat.groq.com/',
    logo: GroqProviderLogo,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'anthropic',
    name: 'Claude',
    url: 'https://claude.ai/',
    logo: ClaudeAppLogo,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'google',
    name: 'Google',
    url: 'https://google.com/',
    logo: GoogleAppLogo,
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
    logo: BaiduAiAppLogo,
    url: 'https://yiyan.baidu.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'baidu-ai-search',
    name: 'Baidu AI Search',
    nameKey: 'minapps.baidu-ai-search',
    logo: BaiduAiSearchLogo,
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
    logo: TencentYuanbaoAppLogo,
    url: 'https://yuanbao.tencent.com/chat',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'sensetime-chat',
    name: 'Sensechat',
    nameKey: 'minapps.sensechat',
    logo: SensetimeAppLogo,
    url: 'https://chat.sensetime.com/wb/chat',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'spark-desk',
    name: 'SparkDesk',
    logo: SparkDeskAppLogo,
    url: 'https://xinghuo.xfyun.cn/desk',
    supportedRegions: ['CN']
  },
  {
    id: 'metaso',
    name: 'Metaso',
    nameKey: 'minapps.metaso',
    logo: MetasoAppLogo,
    url: 'https://metaso.cn/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'poe',
    name: 'Poe',
    logo: PoeAppLogo,
    url: 'https://poe.com',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    logo: PerplexityAppLogo,
    url: 'https://www.perplexity.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'devv',
    name: 'DEVV_',
    logo: DevvAppLogo,
    url: 'https://devv.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'tiangong-ai',
    name: 'Tiangong AI',
    nameKey: 'minapps.tiangong-ai',
    logo: TiangongAiLogo,
    url: 'https://www.tiangong.cn/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'Felo',
    name: 'Felo',
    logo: FeloAppLogo,
    url: 'https://felo.ai/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    logo: DuckDuckGoAppLogo,
    url: 'https://duck.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'bolt',
    name: 'bolt',
    logo: BoltAppLogo,
    url: 'https://bolt.new/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'nm',
    name: 'Nami AI',
    nameKey: 'minapps.nami-ai',
    logo: NamiAiLogo,
    url: 'https://bot.n.cn/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'thinkany',
    name: 'ThinkAny',
    logo: ThinkAnyLogo,
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
    logo: GithubCopilotLogo,
    url: 'https://github.com/copilot',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'genspark',
    name: 'Genspark',
    logo: GensparkLogo,
    url: 'https://www.genspark.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'grok',
    name: 'Grok',
    logo: GrokAppLogo,
    url: 'https://grok.com',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'grok-x',
    name: 'Grok / X',
    logo: GrokXAppLogo,
    url: 'https://x.com/i/grok',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'qwenlm',
    name: 'QwenChat',
    logo: QwenlmAppLogo,
    url: 'https://chat.qwen.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'flowith',
    name: 'Flowith',
    logo: FlowithAppLogo,
    url: 'https://www.flowith.io/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: '3mintop',
    name: '3MinTop',
    logo: ThreeMinTopAppLogo,
    url: 'https://3min.top',
    bodered: false,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'aistudio',
    name: 'AI Studio',
    logo: AIStudioLogo,
    url: 'https://aistudio.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'xiaoyi',
    name: 'Xiaoyi',
    nameKey: 'minapps.xiaoyi',
    logo: XiaoYiAppLogo,
    url: 'https://xiaoyi.huawei.com/chat/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM',
    logo: NotebookLMAppLogo,
    url: 'https://notebooklm.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'coze',
    name: 'Coze',
    logo: CozeAppLogo,
    url: 'https://www.coze.com/space',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'dify',
    name: 'Dify',
    logo: DifyAppLogo,
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
    logo: WPSLingXiLogo,
    url: 'https://copilot.wps.cn/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'lechat',
    name: 'LeChat',
    logo: LeChatLogo,
    url: 'https://chat.mistral.ai/chat',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'abacus',
    name: 'Abacus',
    logo: AbacusLogo,
    url: 'https://apps.abacus.ai/chatllm',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'lambdachat',
    name: 'Lambda Chat',
    logo: LambdaChatLogo,
    url: 'https://lambda.chat/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'monica',
    name: 'Monica',
    logo: MonicaLogo,
    url: 'https://monica.im/home/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'you',
    name: 'You',
    logo: YouLogo,
    url: 'https://you.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'zhihu',
    name: 'Zhihu Zhida',
    nameKey: 'minapps.zhihu',
    logo: ZhihuAppLogo,
    url: 'https://zhida.zhihu.com/',
    bodered: true,
    supportedRegions: ['CN']
  },
  {
    id: 'dangbei',
    name: 'Dangbei AI',
    nameKey: 'minapps.dangbei',
    logo: DangbeiLogo,
    url: 'https://ai.dangbei.com/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: `zai`,
    name: `Z.ai`,
    logo: ZaiAppLogo,
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
    logo: n8nLogo,
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
    logo: LongCatAppLogo,
    url: 'https://longcat.chat/',
    bodered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    id: 'ling',
    name: 'Ant Ling',
    nameKey: 'minapps.ant-ling',
    url: 'https://ling.tbox.cn/chat',
    logo: LingAppLogo,
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
    logo: HuggingChatLogo,
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
