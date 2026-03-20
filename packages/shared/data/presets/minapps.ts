export interface MiniappPreset {
  appId: string
  name: string
  nameKey?: string
  url: string
  bordered?: boolean
  background?: string
  style?: Record<string, any>
  supportedRegions?: ('CN' | 'Global')[]
}
export const PRESETS_MINIAPPS: MiniappPreset[] = [
  {
    appId: 'openai',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'silicon',
    name: 'SiliconFlow',
    url: 'https://cloud.siliconflow.cn/playground/chat',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'yi',
    name: 'Wanzhi',
    nameKey: 'minapps.wanzhi',
    url: 'https://www.wanzhi.com/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'zhipu',
    name: 'ChatGLM',
    nameKey: 'minapps.chatglm',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'moonshot',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'baichuan',
    name: 'Baichuan',
    nameKey: 'minapps.baichuan',
    url: 'https://ying.baichuan-ai.com/chat',
    supportedRegions: ['CN']
  },
  {
    appId: 'dashscope',
    name: 'Qwen',
    nameKey: 'minapps.qwen',
    url: 'https://www.qianwen.com',
    supportedRegions: ['CN']
  },
  {
    appId: 'stepfun',
    name: 'Stepfun',
    nameKey: 'minapps.stepfun',
    url: 'https://stepfun.com',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'doubao',
    name: 'Doubao',
    nameKey: 'minapps.doubao',
    url: 'https://www.doubao.com/chat/',
    supportedRegions: ['CN']
  },
  {
    appId: 'cici',
    name: 'Cici',
    url: 'https://www.cici.com/chat/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'minimax',
    name: 'Hailuo',
    nameKey: 'minapps.hailuo',
    url: 'https://chat.minimaxi.com/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'groq',
    name: 'Groq',
    url: 'https://chat.groq.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'anthropic',
    name: 'Claude',
    url: 'https://claude.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'google',
    name: 'Google',
    url: 'https://google.com/',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'baidu-ai-chat',
    name: 'Wenxin',
    nameKey: 'minapps.wenxin',
    url: 'https://yiyan.baidu.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'baidu-ai-search',
    name: 'Baidu AI Search',
    nameKey: 'minapps.baidu-ai-search',
    url: 'https://chat.baidu.com/',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN']
  },
  {
    appId: 'tencent-yuanbao',
    name: 'Tencent Yuanbao',
    nameKey: 'minapps.tencent-yuanbao',
    url: 'https://yuanbao.tencent.com/chat',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'sensetime-chat',
    name: 'Sensechat',
    nameKey: 'minapps.sensechat',
    url: 'https://chat.sensetime.com/wb/chat',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'spark-desk',
    name: 'SparkDesk',
    url: 'https://xinghuo.xfyun.cn/desk',
    supportedRegions: ['CN']
  },
  {
    appId: 'metaso',
    name: 'Metaso',
    nameKey: 'minapps.metaso',
    url: 'https://metaso.cn/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'poe',
    name: 'Poe',
    url: 'https://poe.com',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'devv',
    name: 'DEVV_',
    url: 'https://devv.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'tiangong-ai',
    name: 'Tiangong AI',
    nameKey: 'minapps.tiangong-ai',
    url: 'https://www.tiangong.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'Felo',
    name: 'Felo',
    url: 'https://felo.ai/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'duckduckgo',
    name: 'DuckDuckGo',
    url: 'https://duck.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'bolt',
    name: 'bolt',
    url: 'https://bolt.new/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'nm',
    name: 'Nami AI',
    nameKey: 'minapps.nami-ai',
    url: 'https://bot.n.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'thinkany',
    name: 'ThinkAny',
    url: 'https://thinkany.ai/',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'github-copilot',
    name: 'GitHub Copilot',
    url: 'https://github.com/copilot',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'genspark',
    name: 'Genspark',
    url: 'https://www.genspark.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'grok',
    name: 'Grok',
    url: 'https://grok.com',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'grok-x',
    name: 'Grok / X',
    url: 'https://x.com/i/grok',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'qwenlm',
    name: 'QwenChat',
    url: 'https://chat.qwen.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'flowith',
    name: 'Flowith',
    url: 'https://www.flowith.io/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: '3mintop',
    name: '3MinTop',
    url: 'https://3min.top',
    bordered: false,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'aistudio',
    name: 'AI Studio',
    url: 'https://aistudio.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'xiaoyi',
    name: 'Xiaoyi',
    nameKey: 'minapps.xiaoyi',
    url: 'https://xiaoyi.huawei.com/chat/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'notebooklm',
    name: 'NotebookLM',
    url: 'https://notebooklm.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'coze',
    name: 'Coze',
    url: 'https://www.coze.com/space',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'dify',
    name: 'Dify',
    url: 'https://cloud.dify.ai/apps',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'wpslingxi',
    name: 'WPS AI',
    nameKey: 'minapps.wps-copilot',
    url: 'https://copilot.wps.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'lechat',
    name: 'LeChat',
    url: 'https://chat.mistral.ai/chat',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'abacus',
    name: 'Abacus',
    url: 'https://apps.abacus.ai/chatllm',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'lambdachat',
    name: 'Lambda Chat',
    url: 'https://lambda.chat/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'monica',
    name: 'Monica',
    url: 'https://monica.im/home/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'you',
    name: 'You',
    url: 'https://you.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'zhihu',
    name: 'Zhihu Zhida',
    nameKey: 'minapps.zhihu',
    url: 'https://zhida.zhihu.com/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'dangbei',
    name: 'Dangbei AI',
    nameKey: 'minapps.dangbei',
    url: 'https://ai.dangbei.com/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: `zai`,
    name: `Z.ai`,
    url: `https://chat.z.ai/`,
    bordered: true,
    style: {
      padding: 10
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'n8n',
    name: 'n8n',
    url: 'https://app.n8n.cloud/',
    bordered: true,
    style: {
      padding: 5
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'longcat',
    name: 'LongCat',
    url: 'https://longcat.chat/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'ling',
    name: 'Ant Ling',
    nameKey: 'minapps.ant-ling',
    url: 'https://ling.tbox.cn/chat',
    bordered: true,
    style: {
      padding: 6
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'huggingchat',
    name: 'HuggingChat',
    url: 'https://huggingface.co/chat/',
    bordered: true,
    style: {
      padding: 6
    },
    supportedRegions: ['CN', 'Global']
  }
]
