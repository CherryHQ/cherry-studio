export interface MiniappPreset {
  appId: string
  name: string
  icon: string
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
    icon: 'openai',
    url: 'https://chatgpt.com/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'gemini',
    name: 'Gemini',
    icon: 'gemini',
    url: 'https://gemini.google.com/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'silicon',
    name: 'SiliconFlow',
    icon: 'silicon',
    url: 'https://cloud.siliconflow.cn/playground/chat',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'deepseek',
    name: 'DeepSeek',
    icon: 'deepseek',
    url: 'https://chat.deepseek.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'yi',
    name: 'Wanzhi',
    nameKey: 'minapps.wanzhi',
    icon: 'zeroOne',
    url: 'https://www.wanzhi.com/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'zhipu',
    name: 'ChatGLM',
    nameKey: 'minapps.chatglm',
    icon: 'zhipu',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'moonshot',
    name: 'Kimi',
    icon: 'kimi',
    url: 'https://kimi.moonshot.cn/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'baichuan',
    name: 'Baichuan',
    nameKey: 'minapps.baichuan',
    icon: 'baichuan',
    url: 'https://ying.baichuan-ai.com/chat',
    supportedRegions: ['CN']
  },
  {
    appId: 'dashscope',
    name: 'Qwen',
    nameKey: 'minapps.qwen',
    icon: 'qwen',
    url: 'https://www.qianwen.com',
    supportedRegions: ['CN']
  },
  {
    appId: 'stepfun',
    name: 'Stepfun',
    nameKey: 'minapps.stepfun',
    icon: 'step',
    url: 'https://stepfun.com',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'doubao',
    name: 'Doubao',
    nameKey: 'minapps.doubao',
    icon: 'doubao',
    url: 'https://www.doubao.com/chat/',
    supportedRegions: ['CN']
  },
  {
    appId: 'cici',
    name: 'Cici',
    icon: 'bytedance',
    url: 'https://www.cici.com/chat/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'minimax',
    name: 'Hailuo',
    nameKey: 'minapps.hailuo',
    icon: 'minimax',
    url: 'https://chat.minimaxi.com/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'groq',
    name: 'Groq',
    icon: 'groq',
    url: 'https://chat.groq.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'anthropic',
    name: 'Claude',
    icon: 'anthropic',
    url: 'https://claude.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'google',
    name: 'Google',
    icon: 'google',
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
    icon: 'wenxin',
    url: 'https://yiyan.baidu.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'baidu-ai-search',
    name: 'Baidu AI Search',
    nameKey: 'minapps.baidu-ai-search',
    icon: 'baidu',
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
    icon: 'yuanbao',
    url: 'https://yuanbao.tencent.com/chat',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'sensetime-chat',
    name: 'Sensechat',
    nameKey: 'minapps.sensechat',
    icon: 'sensetime',
    url: 'https://chat.sensetime.com/wb/chat',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'spark-desk',
    name: 'SparkDesk',
    icon: 'xinghuo',
    url: 'https://xinghuo.xfyun.cn/desk',
    supportedRegions: ['CN']
  },
  {
    appId: 'metaso',
    name: 'Metaso',
    nameKey: 'minapps.metaso',
    icon: 'metaso',
    url: 'https://metaso.cn/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'poe',
    name: 'Poe',
    icon: 'poe',
    url: 'https://poe.com',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'perplexity',
    name: 'Perplexity',
    icon: 'perplexity',
    url: 'https://www.perplexity.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'devv',
    name: 'DEVV_',
    icon: 'devv',
    url: 'https://devv.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'tiangong-ai',
    name: 'Tiangong AI',
    nameKey: 'minapps.tiangong-ai',
    icon: 'tiangong',
    url: 'https://www.tiangong.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'Felo',
    name: 'Felo',
    icon: 'felo',
    url: 'https://felo.ai/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'duckduckgo',
    name: 'DuckDuckGo',
    icon: 'duckduckgo',
    url: 'https://duck.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'bolt',
    name: 'bolt',
    icon: 'bolt',
    url: 'https://bolt.new/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'nm',
    name: 'Nami AI',
    nameKey: 'minapps.nami-ai',
    icon: 'nami',
    url: 'https://bot.n.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'thinkany',
    name: 'ThinkAny',
    icon: 'thinkany',
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
    icon: 'githubCopilot',
    url: 'https://github.com/copilot',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'genspark',
    name: 'Genspark',
    icon: 'genspark',
    url: 'https://www.genspark.ai/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'grok',
    name: 'Grok',
    icon: 'grok',
    url: 'https://grok.com',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'grok-x',
    name: 'Grok / X',
    icon: 'x',
    url: 'https://x.com/i/grok',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'qwenlm',
    name: 'QwenChat',
    icon: 'qwen',
    url: 'https://chat.qwen.ai',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'flowith',
    name: 'Flowith',
    icon: 'flowith',
    url: 'https://www.flowith.io/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: '3mintop',
    name: '3MinTop',
    icon: '3mintop',
    url: 'https://3min.top',
    bordered: false,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'aistudio',
    name: 'AI Studio',
    icon: 'google',
    url: 'https://aistudio.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'xiaoyi',
    name: 'Xiaoyi',
    nameKey: 'minapps.xiaoyi',
    icon: 'xiaoyi',
    url: 'https://xiaoyi.huawei.com/chat/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'notebooklm',
    name: 'NotebookLM',
    icon: 'google',
    url: 'https://notebooklm.google.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'coze',
    name: 'Coze',
    icon: 'coze',
    url: 'https://www.coze.com/space',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'dify',
    name: 'Dify',
    icon: 'dify',
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
    icon: 'wps',
    url: 'https://copilot.wps.cn/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'lechat',
    name: 'LeChat',
    icon: 'mistral',
    url: 'https://chat.mistral.ai/chat',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'abacus',
    name: 'Abacus',
    icon: 'abacus',
    url: 'https://apps.abacus.ai/chatllm',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'lambdachat',
    name: 'Lambda Chat',
    icon: 'lambda',
    url: 'https://lambda.chat/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'monica',
    name: 'Monica',
    icon: 'monica',
    url: 'https://monica.im/home/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'you',
    name: 'You',
    icon: 'you',
    url: 'https://you.com/',
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'zhihu',
    name: 'Zhihu Zhida',
    nameKey: 'minapps.zhihu',
    icon: 'zhihu',
    url: 'https://zhida.zhihu.com/',
    bordered: true,
    supportedRegions: ['CN']
  },
  {
    appId: 'dangbei',
    name: 'Dangbei AI',
    nameKey: 'minapps.dangbei',
    icon: 'dangbei',
    url: 'https://ai.dangbei.com/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'zai',
    name: 'Z.ai',
    icon: 'zai',
    url: 'https://chat.z.ai/',
    bordered: true,
    style: {
      padding: 10
    },
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'n8n',
    name: 'n8n',
    icon: 'n8n',
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
    icon: 'longcat',
    url: 'https://longcat.chat/',
    bordered: true,
    supportedRegions: ['CN', 'Global']
  },
  {
    appId: 'ling',
    name: 'Ant Ling',
    nameKey: 'minapps.ant-ling',
    icon: 'ling',
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
    icon: 'huggingface',
    url: 'https://huggingface.co/chat/',
    bordered: true,
    style: {
      padding: 6
    },
    supportedRegions: ['CN', 'Global']
  }
]
