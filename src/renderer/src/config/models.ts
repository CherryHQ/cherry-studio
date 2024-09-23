import Ai360ModelLogo from '@renderer/assets/images/models/360.png'
import Ai360ModelLogoDark from '@renderer/assets/images/models/360_dark.png'
import AimassModelLogo from '@renderer/assets/images/models/aimass.png'
import AimassModelLogoDark from '@renderer/assets/images/models/aimass_dark.png'
import BaichuanModelLogo from '@renderer/assets/images/models/baichuan.png'
import BaichuanModelLogoDark from '@renderer/assets/images/models/baichuan_dark.png'
import ChatGLMModelLogo from '@renderer/assets/images/models/chatglm.png'
import ChatGLMModelLogoDark from '@renderer/assets/images/models/chatglm_dark.png'
import ClaudeModelLogo from '@renderer/assets/images/models/claude.png'
import ClaudeModelLogoDark from '@renderer/assets/images/models/claude_dark.png'
import CodegeexModelLogo from '@renderer/assets/images/models/codegeex.png'
import CodegeexModelLogoDark from '@renderer/assets/images/models/codegeex_dark.png'
import CohereModelLogo from '@renderer/assets/images/models/cohere.png'
import CohereModelLogoDark from '@renderer/assets/images/models/cohere_dark.png'
import CopilotModelLogo from '@renderer/assets/images/models/copilot.png'
import CopilotModelLogoDark from '@renderer/assets/images/models/copilot_dark.png'
import DalleModelLogo from '@renderer/assets/images/models/dalle.png'
import DalleModelLogoDark from '@renderer/assets/images/models/dalle_dark.png'
import DbrxModalLogo from '@renderer/assets/images/Models/dbrx.png'
import DeepSeekModelLogo from '@renderer/assets/images/models/deepseek.png'
import DeepSeekModelLogoDark from '@renderer/assets/images/models/deepseek_dark.png'
import DoubaoModelLogo from '@renderer/assets/images/models/doubao.png'
import DoubaoModelLogoDark from '@renderer/assets/images/models/doubao_dark.png'
import EmbeddingModelLogo from '@renderer/assets/images/models/embedding.png'
import EmbeddingModelLogoDark from '@renderer/assets/images/models/embedding.png'
import FlashaudioModelLogo from '@renderer/assets/images/models/flashaudio.png'
import FlashaudioModelLogoDark from '@renderer/assets/images/models/flashaudio_dark.png'
import FluxModelLogo from '@renderer/assets/images/models/flux.png'
import FluxModelLogoDark from '@renderer/assets/images/models/flux_dark.png'
import GeminiModelLogo from '@renderer/assets/images/models/gemini.png'
import GeminiModelLogoDark from '@renderer/assets/images/models/gemini_dark.png'
import GemmaModelLogo from '@renderer/assets/images/models/gemma.png'
import GemmaModelLogoDark from '@renderer/assets/images/models/gemma_dark.png'
import GorkModelLogo from '@renderer/assets/images/models/gork.png'
import GorkModelLogoDark from '@renderer/assets/images/models/gork_dark.png'
import ChatGPT35ModelLogo from '@renderer/assets/images/models/gpt_3.5.png'
import ChatGPT4ModelLogo from '@renderer/assets/images/models/gpt_4.png'
import ChatGPT35ModelLogoDark from '@renderer/assets/images/models/gpt_dark.png'
import ChatGPT4ModelLogoDark from '@renderer/assets/images/models/gpt_dark.png'
import ChatGPTo1ModelLogoDark from '@renderer/assets/images/models/gpt_dark.png'
import ChatGPTo1ModelLogo from '@renderer/assets/images/models/gpt_o1.png'
import HailuoModelLogo from '@renderer/assets/images/models/hailuo.png'
import HailuoModelLogoDark from '@renderer/assets/images/models/hailuo_dark.png'
import HunyuanModelLogo from '@renderer/assets/images/models/hunyuan.png'
import HunyuanModelLogoDark from '@renderer/assets/images/models/hunyuan_dark.png'
import InternlmModelLogo from '@renderer/assets/images/models/internlm.png'
import InternlmModelLogoDark from '@renderer/assets/images/models/internlm_dark.png'
import LlamaModelLogo from '@renderer/assets/images/models/llama.png'
import LlamaModelLogoDark from '@renderer/assets/images/models/llama_dark.png'
import LLavaModelLogo from '@renderer/assets/images/models/llava.png'
import LLavaModelLogoDark from '@renderer/assets/images/models/llava_dark.png'
import MagicModelLogo from '@renderer/assets/images/models/magic.png'
import MagicModelLogoDark from '@renderer/assets/images/models/magic_dark.png'
import MicrosoftModelLogo from '@renderer/assets/images/models/microsoft.png'
import MicrosoftModelLogoDark from '@renderer/assets/images/models/microsoft_dark.png'
import MidjourneyModelLogo from '@renderer/assets/images/models/midjourney.png'
import MidjourneyModelLogoDark from '@renderer/assets/images/models/midjourney_dark.png'
import MinicpmModelLogo from '@renderer/assets/images/models/minicpm.webp'
import MinicpmModelLogoDark from '@renderer/assets/images/models/minicpm.webp'
import MinimaxModelLogo from '@renderer/assets/images/models/minimax.png'
import MinimaxModelLogoDark from '@renderer/assets/images/models/minimax_dark.png'
import MistralModelLogo from '@renderer/assets/images/models/mixtral.png'
import MistralModelLogoDark from '@renderer/assets/images/models/mixtral_dark.png'
import MoonshotModelLogo from '@renderer/assets/images/models/moonshot.png'
import MoonshotModelLogoDark from '@renderer/assets/images/models/moonshot_dark.png'
import PalmModelLogo from '@renderer/assets/images/models/palm.png'
import PalmModelLogoDark from '@renderer/assets/images/models/palm_dark.png'
import QwenModelLogo from '@renderer/assets/images/models/qwen.png'
import QwenModelLogoDark from '@renderer/assets/images/models/qwen_dark.png'
import StabilityModelLogo from '@renderer/assets/images/models/stability.png'
import StabilityModelLogoDark from '@renderer/assets/images/models/stability_dark.png'
import StepModelLogo from '@renderer/assets/images/models/step.png'
import StepModelLogoDark from '@renderer/assets/images/models/step_dark.png'
import WenxinModelLogo from '@renderer/assets/images/models/wenxin.png'
import WenxinModelLogoDark from '@renderer/assets/images/models/wenxin_dark.png'
import YiModelLogo from '@renderer/assets/images/models/yi.png'
import YiModelLogoDark from '@renderer/assets/images/models/yi_dark.png'
import { Model } from '@renderer/types'

const TEXT_TO_IMAGE_REGEX = /flux|diffusion|stabilityai|sd-turbo|dall|cogview/i
const VISION_REGEX = /llava|moondream|minicpm|gemini-1.5|claude-3|vision|glm-4v|gpt-4|qwen-vl/i
const EMBEDDING_REGEX = /embedding/i

export function getModelLogo(modelId: string) {
  const isLight = true

  if (!modelId) {
    return undefined
  }

  const logoMap = {
    'o1-': isLight ? ChatGPTo1ModelLogo : ChatGPTo1ModelLogoDark,
    'gpt-3': isLight ? ChatGPT35ModelLogo : ChatGPT35ModelLogoDark,
    'gpt-4': isLight ? ChatGPT4ModelLogo : ChatGPT4ModelLogoDark,
    'text-moderation': isLight ? ChatGPTo1ModelLogo : ChatGPTo1ModelLogoDark,
    glm: isLight ? ChatGLMModelLogo : ChatGLMModelLogoDark,
    deepseek: isLight ? DeepSeekModelLogo : DeepSeekModelLogoDark,
    qwen: isLight ? QwenModelLogo : QwenModelLogoDark,
    gemma: isLight ? GemmaModelLogo : GemmaModelLogoDark,
    'yi-': isLight ? YiModelLogo : YiModelLogoDark,
    llama: isLight ? LlamaModelLogo : LlamaModelLogoDark,
    mixtral: isLight ? MistralModelLogo : MistralModelLogo,
    mistral: isLight ? MistralModelLogo : MistralModelLogoDark,
    moonshot: isLight ? MoonshotModelLogo : MoonshotModelLogoDark,
    phi: isLight ? MicrosoftModelLogo : MicrosoftModelLogoDark,
    baichuan: isLight ? BaichuanModelLogo : BaichuanModelLogoDark,
    claude: isLight ? ClaudeModelLogo : ClaudeModelLogoDark,
    gemini: isLight ? GeminiModelLogo : GeminiModelLogoDark,
    embedding: isLight ? EmbeddingModelLogo : EmbeddingModelLogoDark,
    bison: isLight ? PalmModelLogo : PalmModelLogoDark,
    palm: isLight ? PalmModelLogo : PalmModelLogoDark,
    step: isLight ? StepModelLogo : StepModelLogoDark,
    abab: isLight ? HailuoModelLogo : HailuoModelLogoDark,
    'ep-202': isLight ? DoubaoModelLogo : DoubaoModelLogoDark,
    cohere: isLight ? CohereModelLogo : CohereModelLogoDark,
    command: isLight ? CohereModelLogo : CohereModelLogoDark,
    minicpm: isLight ? MinicpmModelLogo : MinicpmModelLogoDark,
    '360': isLight ? Ai360ModelLogo : Ai360ModelLogoDark,
    aimass: isLight ? AimassModelLogo : AimassModelLogoDark,
    codegeex: isLight ? CodegeexModelLogo : CodegeexModelLogoDark,
    copilot: isLight ? CopilotModelLogo : CopilotModelLogoDark,
    dalle: isLight ? DalleModelLogo : DalleModelLogoDark,
    'dall-e': isLight ? DalleModelLogo : DalleModelLogoDark,
    dbrx: isLight ? DbrxModalLogo : DbrxModalLogo,
    flashaudio: isLight ? FlashaudioModelLogo : FlashaudioModelLogoDark,
    flux: isLight ? FluxModelLogo : FluxModelLogoDark,
    gork: isLight ? GorkModelLogo : GorkModelLogoDark,
    hunyuan: isLight ? HunyuanModelLogo : HunyuanModelLogoDark,
    internlm: isLight ? InternlmModelLogo : InternlmModelLogoDark,
    llava: isLight ? LLavaModelLogo : LLavaModelLogoDark,
    magic: isLight ? MagicModelLogo : MagicModelLogoDark,
    midjourney: isLight ? MidjourneyModelLogo : MidjourneyModelLogoDark,
    minimax: isLight ? MinimaxModelLogo : MinimaxModelLogoDark,
    wenxin: isLight ? WenxinModelLogo : WenxinModelLogoDark,
    voice: isLight ? FlashaudioModelLogo : FlashaudioModelLogoDark,
    tts: isLight ? FlashaudioModelLogo : FlashaudioModelLogoDark,
    stability: isLight ? StabilityModelLogo : StabilityModelLogoDark
  }

  for (const key in logoMap) {
    if (modelId.toLowerCase().includes(key)) {
      return logoMap[key]
    }
  }

  return undefined
}

export const SYSTEM_MODELS: Record<string, Model[]> = {
  ollama: [],
  silicon: [
    {
      id: 'Qwen/Qwen2-7B-Instruct',
      provider: 'silicon',
      name: 'Qwen2-7B-Instruct',
      group: 'Qwen2'
    },
    {
      id: 'Qwen/Qwen2-72B-Instruct',
      provider: 'silicon',
      name: 'Qwen2-72B-Instruct',
      group: 'Qwen2'
    },
    {
      id: 'THUDM/glm-4-9b-chat',
      provider: 'silicon',
      name: 'GLM-4-9B-Chat',
      group: 'GLM'
    },
    {
      id: 'deepseek-ai/DeepSeek-V2-Chat',
      provider: 'silicon',
      name: 'DeepSeek-V2-Chat',
      group: 'DeepSeek'
    },
    {
      id: 'deepseek-ai/DeepSeek-Coder-V2-Instruct',
      provider: 'silicon',
      name: 'DeepSeek-Coder-V2-Instruct',
      group: 'DeepSeek'
    }
  ],
  openai: [
    {
      id: 'gpt-4o',
      provider: 'openai',
      name: ' GPT-4o',
      group: 'GPT 4o'
    },
    {
      id: 'gpt-4o-mini',
      provider: 'openai',
      name: ' GPT-4o-mini',
      group: 'GPT 4o'
    },
    {
      id: 'gpt-4-turbo',
      provider: 'openai',
      name: ' GPT-4 Turbo',
      group: 'GPT 4'
    },
    {
      id: 'gpt-4',
      provider: 'openai',
      name: ' GPT-4',
      group: 'GPT 4'
    }
  ],
  gemini: [
    {
      id: 'gemini-1.5-flash',
      provider: 'gemini',
      name: 'Gemini 1.5 Flash',
      group: 'Gemini 1.5'
    },
    {
      id: 'gemini-1.5-pro-exp-0801',
      provider: 'gemini',
      name: 'Gemini 1.5 Pro Experimental 0801',
      group: 'Gemini 1.5'
    }
  ],
  anthropic: [
    {
      id: 'claude-3-5-sonnet-20240620',
      provider: 'anthropic',
      name: 'Claude 3.5 Sonnet',
      group: 'Claude 3.5'
    },
    {
      id: 'claude-3-opus-20240229',
      provider: 'anthropic',
      name: 'Claude 3 Opus',
      group: 'Claude 3'
    },
    {
      id: 'claude-3-sonnet-20240229',
      provider: 'anthropic',
      name: 'Claude 3 Sonnet',
      group: 'Claude 3'
    },
    {
      id: 'claude-3-haiku-20240307',
      provider: 'anthropic',
      name: 'Claude 3 Haiku',
      group: 'Claude 3'
    }
  ],
  deepseek: [
    {
      id: 'deepseek-chat',
      provider: 'deepseek',
      name: 'DeepSeek Chat',
      group: 'DeepSeek Chat'
    },
    {
      id: 'deepseek-coder',
      provider: 'deepseek',
      name: 'DeepSeek Coder',
      group: 'DeepSeek Coder'
    }
  ],
  github: [
    {
      id: 'gpt-4o',
      provider: 'github',
      name: 'OpenAI GPT-4o',
      group: 'OpenAI'
    }
  ],
  yi: [
    {
      id: 'yi-large',
      provider: 'yi',
      name: 'Yi-Large',
      group: 'Yi'
    },
    {
      id: 'yi-large-turbo',
      provider: 'yi',
      name: 'Yi-Large-Turbo',
      group: 'Yi'
    },
    {
      id: 'yi-large-rag',
      provider: 'yi',
      name: 'Yi-Large-Rag',
      group: 'Yi'
    },
    {
      id: 'yi-medium',
      provider: 'yi',
      name: 'Yi-Medium',
      group: 'Yi'
    },
    {
      id: 'yi-medium-200k',
      provider: 'yi',
      name: 'Yi-Medium-200k',
      group: 'Yi'
    },
    {
      id: 'yi-spark',
      provider: 'yi',
      name: 'Yi-Spark',
      group: 'Yi'
    }
  ],
  zhipu: [
    {
      id: 'glm-4',
      provider: 'zhipu',
      name: 'GLM-4',
      group: 'GLM-4'
    },
    {
      id: 'glm-4-plus',
      provider: 'zhipu',
      name: 'GLM-4-Plus',
      group: 'GLM-4'
    },
    {
      id: 'glm-4-air',
      provider: 'zhipu',
      name: 'GLM-4-Air',
      group: 'GLM-4'
    },
    {
      id: 'glm-4-airx',
      provider: 'zhipu',
      name: 'GLM-4-AirX',
      group: 'GLM-4'
    },
    {
      id: 'glm-4-flash',
      provider: 'zhipu',
      name: 'GLM-4-Flash',
      group: 'GLM-4'
    },
    {
      id: 'glm-4v',
      provider: 'zhipu',
      name: 'GLM 4V',
      group: 'GLM-4v'
    },
    {
      id: 'glm-4v-plus',
      provider: 'zhipu',
      name: 'GLM-4V-Plus',
      group: 'GLM-4v'
    },
    {
      id: 'glm-4-alltools',
      provider: 'zhipu',
      name: 'GLM-4-AllTools',
      group: 'GLM-4-AllTools'
    }
  ],
  moonshot: [
    {
      id: 'moonshot-v1-8k',
      provider: 'moonshot',
      name: 'Moonshot V1 8k',
      group: 'Moonshot V1'
    },
    {
      id: 'moonshot-v1-32k',
      provider: 'moonshot',
      name: 'Moonshot V1 32k',
      group: 'Moonshot V1'
    },
    {
      id: 'moonshot-v1-128k',
      provider: 'moonshot',
      name: 'Moonshot V1 128k',
      group: 'Moonshot V1'
    }
  ],
  baichuan: [
    {
      id: 'Baichuan4',
      provider: 'baichuan',
      name: 'Baichuan4',
      group: 'Baichuan4'
    },
    {
      id: 'Baichuan3-Turbo',
      provider: 'baichuan',
      name: 'Baichuan3 Turbo',
      group: 'Baichuan3'
    },
    {
      id: 'Baichuan3-Turbo-128k',
      provider: 'baichuan',
      name: 'Baichuan3 Turbo 128k',
      group: 'Baichuan3'
    }
  ],
  dashscope: [
    {
      id: 'qwen-turbo',
      provider: 'dashscope',
      name: 'Qwen Turbo',
      group: 'Qwen'
    },
    {
      id: 'qwen-plus',
      provider: 'dashscope',
      name: 'Qwen Plus',
      group: 'Qwen'
    },
    {
      id: 'qwen-max',
      provider: 'dashscope',
      name: 'Qwen Max',
      group: 'Qwen'
    }
  ],
  stepfun: [
    {
      id: 'step-1-8k',
      provider: 'stepfun',
      name: 'Step 1 8K',
      group: 'Step 1'
    },
    {
      id: 'step-1-flash',
      provider: 'stepfun',
      name: 'Step 1 Flash',
      group: 'Step 1'
    }
  ],
  doubao: [],
  minimax: [
    {
      id: 'abab6.5s-chat',
      provider: 'minimax',
      name: 'abab6.5s',
      group: 'abab6'
    },
    {
      id: 'abab6.5g-chat',
      provider: 'minimax',
      name: 'abab6.5g',
      group: 'abab6'
    },
    {
      id: 'abab6.5t-chat',
      provider: 'minimax',
      name: 'abab6.5t',
      group: 'abab6'
    },
    {
      id: 'abab5.5s-chat',
      provider: 'minimax',
      name: 'abab5.5s',
      group: 'abab5'
    }
  ],
  aihubmix: [
    {
      id: 'gpt-4o-mini',
      provider: 'aihubmix',
      name: 'GPT-4o Mini',
      group: 'GPT-4o'
    },
    {
      id: 'aihubmix-Llama-3-70B-Instruct',
      provider: 'aihubmix',
      name: 'Llama 3 70B Instruct',
      group: 'Llama3'
    }
  ],
  openrouter: [
    {
      id: 'google/gemma-2-9b-it:free',
      provider: 'openrouter',
      name: 'Google: Gemma 2 9B',
      group: 'Gemma'
    },
    {
      id: 'microsoft/phi-3-mini-128k-instruct:free',
      provider: 'openrouter',
      name: 'Phi-3 Mini 128K Instruct',
      group: 'Phi'
    },
    {
      id: 'microsoft/phi-3-medium-128k-instruct:free',
      provider: 'openrouter',
      name: 'Phi-3 Medium 128K Instruct',
      group: 'Phi'
    },
    {
      id: 'meta-llama/llama-3-8b-instruct:free',
      provider: 'openrouter',
      name: 'Meta: Llama 3 8B Instruct',
      group: 'Llama3'
    },
    {
      id: 'mistralai/mistral-7b-instruct:free',
      provider: 'openrouter',
      name: 'Mistral: Mistral 7B Instruct',
      group: 'Mistral'
    }
  ],
  groq: [
    {
      id: 'llama3-8b-8192',
      provider: 'groq',
      name: 'LLaMA3 8B',
      group: 'Llama3'
    },
    {
      id: 'llama3-70b-8192',
      provider: 'groq',
      name: 'LLaMA3 70B',
      group: 'Llama3'
    },
    {
      id: 'mixtral-8x7b-32768',
      provider: 'groq',
      name: 'Mixtral 8x7B',
      group: 'Mixtral'
    },
    {
      id: 'gemma-7b-it',
      provider: 'groq',
      name: 'Gemma 7B',
      group: 'Gemma'
    }
  ]
}

export function isTextToImageModel(model: Model): boolean {
  return TEXT_TO_IMAGE_REGEX.test(model.id)
}

export function isEmbeddingModel(model: Model): boolean {
  return EMBEDDING_REGEX.test(model.id)
}

export function isVisionModel(model: Model): boolean {
  return VISION_REGEX.test(model.id)
}
