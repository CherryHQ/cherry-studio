import BaicuanAppLogo from '@renderer/assets/images/apps/baixiaoying.webp'
import KimiAppLogo from '@renderer/assets/images/apps/kimi.jpg'
import YuewenAppLogo from '@renderer/assets/images/apps/yuewen.png'
import BaichuanModelLogo from '@renderer/assets/images/models/baichuan.png'
import ChatGLMModelLogo from '@renderer/assets/images/models/chatglm.png'
import ChatGPTModelLogo from '@renderer/assets/images/models/chatgpt.jpeg'
import ClaudeModelLogo from '@renderer/assets/images/models/claude.png'
import CohereModelLogo from '@renderer/assets/images/models/cohere.webp'
import DeepSeekModelLogo from '@renderer/assets/images/models/deepseek.png'
import DoubaoModelLogo from '@renderer/assets/images/models/doubao.png'
import EmbeddingModelLogo from '@renderer/assets/images/models/embedding.png'
import GeminiModelLogo from '@renderer/assets/images/models/gemini.png'
import GemmaModelLogo from '@renderer/assets/images/models/gemma.jpeg'
import HailuoModelLogo from '@renderer/assets/images/models/hailuo.png'
import LlamaModelLogo from '@renderer/assets/images/models/llama.jpeg'
import MicrosoftModelLogo from '@renderer/assets/images/models/microsoft.png'
import MinicpmModelLogo from '@renderer/assets/images/models/minicpm.webp'
import MixtralModelLogo from '@renderer/assets/images/models/mixtral.jpeg'
import PalmModelLogo from '@renderer/assets/images/models/palm.svg'
import QwenModelLogo from '@renderer/assets/images/models/qwen.png'
import StepModelLogo from '@renderer/assets/images/models/step.jpg'
import YiModelLogo from '@renderer/assets/images/models/yi.png'
import AiHubMixProviderLogo from '@renderer/assets/images/providers/aihubmix.jpg'
import AnthropicProviderLogo from '@renderer/assets/images/providers/anthropic.jpeg'
import BaichuanProviderLogo from '@renderer/assets/images/providers/baichuan.png'
import DashScopeProviderLogo from '@renderer/assets/images/providers/dashscope.png'
import DeepSeekProviderLogo from '@renderer/assets/images/providers/deepseek.png'
import DoubaoProviderLogo from '@renderer/assets/images/providers/doubao.png'
import GeminiProviderLogo from '@renderer/assets/images/providers/gemini.png'
import GithubProviderLogo from '@renderer/assets/images/providers/github.svg'
import GraphRagProviderLogo from '@renderer/assets/images/providers/graph-rag.png'
import GroqProviderLogo from '@renderer/assets/images/providers/groq.png'
import MinimaxProviderLogo from '@renderer/assets/images/providers/minimax.png'
import MoonshotProviderLogo from '@renderer/assets/images/providers/moonshot.jpg'
import MoonshotModelLogo from '@renderer/assets/images/providers/moonshot.jpg'
import OllamaProviderLogo from '@renderer/assets/images/providers/ollama.png'
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png'
import OpenRouterProviderLogo from '@renderer/assets/images/providers/openrouter.png'
import SiliconFlowProviderLogo from '@renderer/assets/images/providers/silicon.png'
import StepFunProviderLogo from '@renderer/assets/images/providers/stepfun.png'
import YiProviderLogo from '@renderer/assets/images/providers/yi.png'
import ZhipuProviderLogo from '@renderer/assets/images/providers/zhipu.png'

export function getProviderLogo(providerId: string) {
  switch (providerId) {
    case 'openai':
      return OpenAiProviderLogo
    case 'silicon':
      return SiliconFlowProviderLogo
    case 'deepseek':
      return DeepSeekProviderLogo
    case 'yi':
      return YiProviderLogo
    case 'groq':
      return GroqProviderLogo
    case 'zhipu':
      return ZhipuProviderLogo
    case 'ollama':
      return OllamaProviderLogo
    case 'moonshot':
      return MoonshotProviderLogo
    case 'openrouter':
      return OpenRouterProviderLogo
    case 'baichuan':
      return BaichuanProviderLogo
    case 'dashscope':
      return DashScopeProviderLogo
    case 'anthropic':
      return AnthropicProviderLogo
    case 'aihubmix':
      return AiHubMixProviderLogo
    case 'gemini':
      return GeminiProviderLogo
    case 'stepfun':
      return StepFunProviderLogo
    case 'doubao':
      return DoubaoProviderLogo
    case 'graphrag-kylin-mountain':
      return GraphRagProviderLogo
    case 'minimax':
      return MinimaxProviderLogo
    case 'github':
      return GithubProviderLogo
    default:
      return undefined
  }
}

export function getModelLogo(modelId: string) {
  if (!modelId) {
    return undefined
  }

  const logoMap = {
    o1: OpenAiProviderLogo,
    gpt: ChatGPTModelLogo,
    glm: ChatGLMModelLogo,
    deepseek: DeepSeekModelLogo,
    qwen: QwenModelLogo,
    gemma: GemmaModelLogo,
    'yi-': YiModelLogo,
    llama: LlamaModelLogo,
    mixtral: MixtralModelLogo,
    mistral: MixtralModelLogo,
    moonshot: MoonshotModelLogo,
    phi: MicrosoftModelLogo,
    baichuan: BaichuanModelLogo,
    claude: ClaudeModelLogo,
    gemini: GeminiModelLogo,
    embedding: EmbeddingModelLogo,
    bison: PalmModelLogo,
    palm: PalmModelLogo,
    step: StepModelLogo,
    abab: HailuoModelLogo,
    'ep-202': DoubaoModelLogo,
    cohere: CohereModelLogo,
    command: CohereModelLogo,
    minicpm: MinicpmModelLogo
  }

  for (const key in logoMap) {
    if (modelId.toLowerCase().includes(key)) {
      return logoMap[key]
    }
  }

  return undefined
}

export const PROVIDER_CONFIG = {
  openai: {
    api: {
      url: 'https://api.openai.com'
    },
    websites: {
      official: 'https://openai.com/',
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      models: 'https://platform.openai.com/docs/models'
    },
    app: {
      id: 'openai',
      name: 'ChatGPT',
      url: 'https://chatgpt.com/',
      logo: OpenAiProviderLogo
    }
  },
  gemini: {
    api: {
      url: 'https://generativelanguage.googleapis.com'
    },
    websites: {
      official: 'https://gemini.google.com/',
      apiKey: 'https://aistudio.google.com/app/apikey',
      docs: 'https://ai.google.dev/gemini-api/docs',
      models: 'https://ai.google.dev/gemini-api/docs/models/gemini'
    },
    app: {
      id: 'gemini',
      name: 'Gemini',
      url: 'https://gemini.google.com/',
      logo: GeminiProviderLogo
    }
  },
  silicon: {
    api: {
      url: 'https://api.siliconflow.cn'
    },
    websites: {
      official: 'https://www.siliconflow.cn/',
      apiKey: 'https://cloud.siliconflow.cn/account/ak?referrer=clxty1xuy0014lvqwh5z50i88',
      docs: 'https://docs.siliconflow.cn/',
      models: 'https://docs.siliconflow.cn/docs/model-names'
    },
    app: {
      id: 'silicon',
      name: 'SiliconFlow',
      url: 'https://cloud.siliconflow.cn/playground/chat',
      logo: SiliconFlowProviderLogo
    }
  },
  deepseek: {
    api: {
      url: 'https://api.deepseek.com'
    },
    websites: {
      official: 'https://deepseek.com/',
      apiKey: 'https://platform.deepseek.com/api_keys',
      docs: 'https://platform.deepseek.com/api-docs/',
      models: 'https://platform.deepseek.com/api-docs/'
    },
    app: {
      id: 'deepseek',
      name: 'DeepSeek',
      url: 'https://chat.deepseek.com/',
      logo: DeepSeekProviderLogo
    }
  },
  github: {
    api: {
      url: 'https://models.inference.ai.azure.com/'
    },
    websites: {
      official: 'https://github.com/marketplace/models',
      apiKey: 'https://github.com/settings/tokens',
      docs: 'https://docs.github.com/en/github-models',
      models: 'https://github.com/marketplace/models'
    }
  },
  yi: {
    api: {
      url: 'https://api.lingyiwanwu.com'
    },
    websites: {
      official: 'https://platform.lingyiwanwu.com/',
      apiKey: 'https://platform.lingyiwanwu.com/apikeys',
      docs: 'https://platform.lingyiwanwu.com/docs',
      models: 'https://platform.lingyiwanwu.com/docs#%E6%A8%A1%E5%9E%8B'
    },
    app: {
      id: 'yi',
      name: 'Yi',
      url: 'https://www.wanzhi.com/',
      logo: YiProviderLogo
    }
  },
  zhipu: {
    api: {
      url: 'https://open.bigmodel.cn/api/paas/v4/'
    },
    websites: {
      official: 'https://open.bigmodel.cn/',
      apiKey: 'https://open.bigmodel.cn/usercenter/apikeys',
      docs: 'https://open.bigmodel.cn/dev/howuse/introduction',
      models: 'https://open.bigmodel.cn/modelcenter/square'
    },
    app: {
      id: 'zhipu',
      name: '智谱',
      url: 'https://chatglm.cn/main/alltoolsdetail',
      logo: ZhipuProviderLogo
    }
  },
  moonshot: {
    api: {
      url: 'https://api.moonshot.cn'
    },
    websites: {
      official: 'https://moonshot.ai/',
      apiKey: 'https://platform.moonshot.cn/console/api-keys',
      docs: 'https://platform.moonshot.cn/docs/',
      models: 'https://platform.moonshot.cn/docs/intro#%E6%A8%A1%E5%9E%8B%E5%88%97%E8%A1%A8'
    },
    app: {
      id: 'moonshot',
      name: 'Kimi',
      url: 'https://kimi.moonshot.cn/',
      logo: KimiAppLogo
    }
  },
  baichuan: {
    api: {
      url: 'https://api.baichuan-ai.com'
    },
    websites: {
      official: 'https://www.baichuan-ai.com/',
      apiKey: 'https://platform.baichuan-ai.com/console/apikey',
      docs: 'https://platform.baichuan-ai.com/docs',
      models: 'https://platform.baichuan-ai.com/price'
    },
    app: {
      id: 'baichuan',
      name: '百小应',
      url: 'https://ying.baichuan-ai.com/chat',
      logo: BaicuanAppLogo
    }
  },
  dashscope: {
    api: {
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
    },
    websites: {
      official: 'https://dashscope.aliyun.com/',
      apiKey: 'https://help.aliyun.com/zh/dashscope/developer-reference/acquisition-and-configuration-of-api-key',
      docs: 'https://help.aliyun.com/zh/dashscope/',
      models: 'https://dashscope.console.aliyun.com/model'
    },
    app: {
      id: 'dashscope',
      name: '通义千问',
      url: 'https://tongyi.aliyun.com/qianwen/',
      logo: QwenModelLogo
    }
  },
  stepfun: {
    api: {
      url: 'https://api.stepfun.com'
    },
    websites: {
      official: 'https://platform.stepfun.com/',
      apiKey: 'https://platform.stepfun.com/interface-key',
      docs: 'https://platform.stepfun.com/docs/overview/concept',
      models: 'https://platform.stepfun.com/docs/llm/text'
    },
    app: {
      id: 'stepfun',
      name: '跃问',
      url: 'https://yuewen.cn/chats/new',
      logo: YuewenAppLogo
    }
  },
  doubao: {
    api: {
      url: 'https://ark.cn-beijing.volces.com/api/v3/'
    },
    websites: {
      official: 'https://console.volcengine.com/ark/',
      apiKey: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
      docs: 'https://www.volcengine.com/docs/82379/1182403',
      models: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint'
    },
    app: {
      id: 'doubao',
      name: '豆包',
      url: 'https://www.doubao.com/chat/',
      logo: DoubaoProviderLogo
    }
  },
  minimax: {
    api: {
      url: 'https://api.minimax.chat/v1/'
    },
    websites: {
      official: 'https://platform.minimaxi.com/',
      apiKey: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      docs: 'https://platform.minimaxi.com/document/Announcement',
      models: 'https://platform.minimaxi.com/document/Models'
    },
    app: {
      id: 'minimax',
      name: '海螺',
      url: 'https://hailuoai.com/',
      logo: HailuoModelLogo
    }
  },
  'graphrag-kylin-mountain': {
    api: {
      url: ''
    }
  },
  openrouter: {
    api: {
      url: 'https://openrouter.ai/api/v1/'
    },
    websites: {
      official: 'https://openrouter.ai/',
      apiKey: 'https://openrouter.ai/settings/keys',
      docs: 'https://openrouter.ai/docs/quick-start',
      models: 'https://openrouter.ai/docs/models'
    }
  },
  groq: {
    api: {
      url: 'https://api.groq.com/openai'
    },
    websites: {
      official: 'https://groq.com/',
      apiKey: 'https://console.groq.com/keys',
      docs: 'https://console.groq.com/docs/quickstart',
      models: 'https://console.groq.com/docs/models'
    },
    app: {
      id: 'groq',
      name: 'Groq',
      url: 'https://chat.groq.com/',
      logo: GroqProviderLogo
    }
  },
  ollama: {
    api: {
      url: 'http://localhost:11434/v1/'
    },
    websites: {
      official: 'https://ollama.com/',
      docs: 'https://github.com/ollama/ollama/tree/main/docs',
      models: 'https://ollama.com/library'
    }
  },
  anthropic: {
    api: {
      url: 'https://api.anthropic.com/'
    },
    websites: {
      official: 'https://anthropic.com/',
      apiKey: 'https://console.anthropic.com/settings/keys',
      docs: 'https://docs.anthropic.com/en/docs',
      models: 'https://docs.anthropic.com/en/docs/about-claude/models'
    },
    app: {
      id: 'anthropic',
      name: 'Claude',
      url: 'https://claude.ai/',
      logo: AnthropicProviderLogo
    }
  },
  aihubmix: {
    api: {
      url: 'https://aihubmix.com'
    },
    websites: {
      official: 'https://aihubmix.com/',
      apiKey: 'https://aihubmix.com/token',
      docs: 'https://doc.aihubmix.com/',
      models: 'https://aihubmix.com/models'
    }
  }
}
