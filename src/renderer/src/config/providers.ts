import ZhinaoProviderLogo from '@renderer/assets/images/models/360.png'
import HunyuanProviderLogo from '@renderer/assets/images/models/hunyuan.png'
import AzureProviderLogo from '@renderer/assets/images/models/microsoft.png'
import Ai302ProviderLogo from '@renderer/assets/images/providers/302ai.webp'
import AiHubMixProviderLogo from '@renderer/assets/images/providers/aihubmix.webp'
import AiOnlyProviderLogo from '@renderer/assets/images/providers/aiOnly.png'
import AlayaNewProviderLogo from '@renderer/assets/images/providers/alayanew.webp'
import AnthropicProviderLogo from '@renderer/assets/images/providers/anthropic.png'
import AwsProviderLogo from '@renderer/assets/images/providers/aws-bedrock.webp'
import BaichuanProviderLogo from '@renderer/assets/images/providers/baichuan.png'
import BaiduCloudProviderLogo from '@renderer/assets/images/providers/baidu-cloud.svg'
import BailianProviderLogo from '@renderer/assets/images/providers/bailian.png'
import BurnCloudProviderLogo from '@renderer/assets/images/providers/burncloud.png'
import CephalonProviderLogo from '@renderer/assets/images/providers/cephalon.jpeg'
import CherryInProviderLogo from '@renderer/assets/images/providers/cherryin.png'
import DeepSeekProviderLogo from '@renderer/assets/images/providers/deepseek.png'
import DmxapiProviderLogo from '@renderer/assets/images/providers/DMXAPI.png'
import FireworksProviderLogo from '@renderer/assets/images/providers/fireworks.png'
import GiteeAIProviderLogo from '@renderer/assets/images/providers/gitee-ai.png'
import GithubProviderLogo from '@renderer/assets/images/providers/github.png'
import GoogleProviderLogo from '@renderer/assets/images/providers/google.png'
import GPUStackProviderLogo from '@renderer/assets/images/providers/gpustack.svg'
import GrokProviderLogo from '@renderer/assets/images/providers/grok.png'
import GroqProviderLogo from '@renderer/assets/images/providers/groq.png'
import HyperbolicProviderLogo from '@renderer/assets/images/providers/hyperbolic.png'
import InfiniProviderLogo from '@renderer/assets/images/providers/infini.png'
import JinaProviderLogo from '@renderer/assets/images/providers/jina.png'
import LanyunProviderLogo from '@renderer/assets/images/providers/lanyun.png'
import LMStudioProviderLogo from '@renderer/assets/images/providers/lmstudio.png'
import MinimaxProviderLogo from '@renderer/assets/images/providers/minimax.png'
import MistralProviderLogo from '@renderer/assets/images/providers/mistral.png'
import ModelScopeProviderLogo from '@renderer/assets/images/providers/modelscope.png'
import MoonshotProviderLogo from '@renderer/assets/images/providers/moonshot.png'
import NewAPIProviderLogo from '@renderer/assets/images/providers/newapi.png'
import NvidiaProviderLogo from '@renderer/assets/images/providers/nvidia.png'
import O3ProviderLogo from '@renderer/assets/images/providers/o3.png'
import OcoolAiProviderLogo from '@renderer/assets/images/providers/ocoolai.png'
import OllamaProviderLogo from '@renderer/assets/images/providers/ollama.png'
import OpenAiProviderLogo from '@renderer/assets/images/providers/openai.png'
import OpenRouterProviderLogo from '@renderer/assets/images/providers/openrouter.png'
import PerplexityProviderLogo from '@renderer/assets/images/providers/perplexity.png'
import Ph8ProviderLogo from '@renderer/assets/images/providers/ph8.png'
import PPIOProviderLogo from '@renderer/assets/images/providers/ppio.png'
import QiniuProviderLogo from '@renderer/assets/images/providers/qiniu.webp'
import SiliconFlowProviderLogo from '@renderer/assets/images/providers/silicon.png'
import StepProviderLogo from '@renderer/assets/images/providers/step.png'
import TencentCloudProviderLogo from '@renderer/assets/images/providers/tencent-cloud-ti.png'
import TogetherProviderLogo from '@renderer/assets/images/providers/together.png'
import TokenFluxProviderLogo from '@renderer/assets/images/providers/tokenflux.png'
import VertexAIProviderLogo from '@renderer/assets/images/providers/vertexai.svg'
import BytedanceProviderLogo from '@renderer/assets/images/providers/volcengine.png'
import VoyageAIProviderLogo from '@renderer/assets/images/providers/voyageai.png'
import XirangProviderLogo from '@renderer/assets/images/providers/xirang.png'
import ZeroOneProviderLogo from '@renderer/assets/images/providers/zero-one.png'
import ZhipuProviderLogo from '@renderer/assets/images/providers/zhipu.png'
import {
  AtLeast,
  isSystemProvider,
  OpenAIServiceTiers,
  Provider,
  ProviderType,
  SystemProvider,
  SystemProviderId
} from '@renderer/types'

import { TOKENFLUX_HOST } from './constant'
import { SYSTEM_MODELS } from './models'

export const SYSTEM_PROVIDERS_CONFIG: Record<SystemProviderId, SystemProvider> = {
  cherryin: {
    id: 'cherryin',
    name: 'CherryIN',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.cherry-ai.com/',
    models: SYSTEM_MODELS.cherryin,
    isSystem: true,
    enabled: true
  },
  silicon: {
    id: 'silicon',
    name: 'Silicon',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.siliconflow.cn',
    models: SYSTEM_MODELS.silicon,
    isSystem: true,
    enabled: false
  },
  aihubmix: {
    id: 'aihubmix',
    name: 'AiHubMix',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://aihubmix.com',
    models: SYSTEM_MODELS.aihubmix,
    isSystem: true,
    enabled: false
  },
  ocoolai: {
    id: 'ocoolai',
    name: 'ocoolAI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.ocoolai.com',
    models: SYSTEM_MODELS.ocoolai,
    isSystem: true,
    enabled: false
  },
  zhipu: {
    id: 'zhipu',
    name: 'ZhiPu',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://open.bigmodel.cn/api/paas/v4/',
    models: SYSTEM_MODELS.zhipu,
    isSystem: true,
    enabled: false
  },
  deepseek: {
    id: 'deepseek',
    name: 'deepseek',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.deepseek.com',
    models: SYSTEM_MODELS.deepseek,
    isSystem: true,
    enabled: false
  },
  ppio: {
    id: 'ppio',
    name: 'PPIO',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.ppinfra.com/v3/openai/',
    models: SYSTEM_MODELS.ppio,
    isSystem: true,
    enabled: false
  },
  alayanew: {
    id: 'alayanew',
    name: 'AlayaNew',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://deepseek.alayanew.com',
    models: SYSTEM_MODELS.alayanew,
    isSystem: true,
    enabled: false
  },
  qiniu: {
    id: 'qiniu',
    name: 'Qiniu',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.qnaigc.com',
    models: SYSTEM_MODELS.qiniu,
    isSystem: true,
    enabled: false
  },
  dmxapi: {
    id: 'dmxapi',
    name: 'DMXAPI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://www.dmxapi.cn',
    models: SYSTEM_MODELS.dmxapi,
    isSystem: true,
    enabled: false
  },
  burncloud: {
    id: 'burncloud',
    name: 'BurnCloud',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://ai.burncloud.com',
    models: SYSTEM_MODELS.burncloud,
    isSystem: true,
    enabled: false
  },
  tokenflux: {
    id: 'tokenflux',
    name: 'TokenFlux',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://tokenflux.ai',
    models: SYSTEM_MODELS.tokenflux,
    isSystem: true,
    enabled: false
  },
  '302ai': {
    id: '302ai',
    name: '302.AI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.302.ai',
    models: SYSTEM_MODELS['302ai'],
    isSystem: true,
    enabled: false
  },
  cephalon: {
    id: 'cephalon',
    name: 'Cephalon',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://cephalon.cloud/user-center/v1/model',
    models: SYSTEM_MODELS.cephalon,
    isSystem: true,
    enabled: false
  },
  lanyun: {
    id: 'lanyun',
    name: 'LANYUN',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://maas-api.lanyun.net',
    models: SYSTEM_MODELS.lanyun,
    isSystem: true,
    enabled: false
  },
  ph8: {
    id: 'ph8',
    name: 'PH8',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://ph8.co',
    models: SYSTEM_MODELS.ph8,
    isSystem: true,
    enabled: false
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://openrouter.ai/api/v1/',
    models: SYSTEM_MODELS.openrouter,
    isSystem: true,
    enabled: false
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    type: 'openai',
    apiKey: '',
    apiHost: 'http://localhost:11434',
    models: SYSTEM_MODELS.ollama,
    isSystem: true,
    enabled: false
  },
  'new-api': {
    id: 'new-api',
    name: 'New API',
    type: 'openai',
    apiKey: '',
    apiHost: 'http://localhost:3000',
    models: SYSTEM_MODELS['new-api'],
    isSystem: true,
    enabled: false
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio',
    type: 'openai',
    apiKey: '',
    apiHost: 'http://localhost:1234',
    models: SYSTEM_MODELS.lmstudio,
    isSystem: true,
    enabled: false
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    apiKey: '',
    apiHost: 'https://api.anthropic.com/',
    models: SYSTEM_MODELS.anthropic,
    isSystem: true,
    enabled: false
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai-response',
    apiKey: '',
    apiHost: 'https://api.openai.com',
    models: SYSTEM_MODELS.openai,
    isSystem: true,
    enabled: false,
    serviceTier: OpenAIServiceTiers.auto
  },
  'azure-openai': {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    type: 'azure-openai',
    apiKey: '',
    apiHost: '',
    apiVersion: '',
    models: SYSTEM_MODELS['azure-openai'],
    isSystem: true,
    enabled: false
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    type: 'gemini',
    apiKey: '',
    apiHost: 'https://generativelanguage.googleapis.com',
    models: SYSTEM_MODELS.gemini,
    isSystem: true,
    enabled: false,
    isVertex: false
  },
  vertexai: {
    id: 'vertexai',
    name: 'VertexAI',
    type: 'vertexai',
    apiKey: '',
    apiHost: 'https://aiplatform.googleapis.com',
    models: SYSTEM_MODELS.vertexai,
    isSystem: true,
    enabled: false,
    isVertex: true
  },
  github: {
    id: 'github',
    name: 'Github Models',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://models.github.ai/inference',
    models: SYSTEM_MODELS.github,
    isSystem: true,
    enabled: false
  },
  copilot: {
    id: 'copilot',
    name: 'Github Copilot',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.githubcopilot.com/',
    models: SYSTEM_MODELS.copilot,
    isSystem: true,
    enabled: false,
    isAuthed: false
  },
  yi: {
    id: 'yi',
    name: 'Yi',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.lingyiwanwu.com',
    models: SYSTEM_MODELS.yi,
    isSystem: true,
    enabled: false
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot AI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.moonshot.cn',
    models: SYSTEM_MODELS.moonshot,
    isSystem: true,
    enabled: false
  },
  baichuan: {
    id: 'baichuan',
    name: 'BAICHUAN AI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.baichuan-ai.com',
    models: SYSTEM_MODELS.baichuan,
    isSystem: true,
    enabled: false
  },
  dashscope: {
    id: 'dashscope',
    name: 'Bailian',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
    models: SYSTEM_MODELS.dashscope,
    isSystem: true,
    enabled: false
  },
  stepfun: {
    id: 'stepfun',
    name: 'StepFun',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.stepfun.com',
    models: SYSTEM_MODELS.stepfun,
    isSystem: true,
    enabled: false
  },
  doubao: {
    id: 'doubao',
    name: 'doubao',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://ark.cn-beijing.volces.com/api/v3/',
    models: SYSTEM_MODELS.doubao,
    isSystem: true,
    enabled: false
  },
  infini: {
    id: 'infini',
    name: 'Infini',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://cloud.infini-ai.com/maas',
    models: SYSTEM_MODELS.infini,
    isSystem: true,
    enabled: false
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.minimax.chat/v1/',
    models: SYSTEM_MODELS.minimax,
    isSystem: true,
    enabled: false
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.groq.com/openai',
    models: SYSTEM_MODELS.groq,
    isSystem: true,
    enabled: false
  },
  together: {
    id: 'together',
    name: 'Together',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.together.xyz',
    models: SYSTEM_MODELS.together,
    isSystem: true,
    enabled: false
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.fireworks.ai/inference',
    models: SYSTEM_MODELS.fireworks,
    isSystem: true,
    enabled: false
  },
  nvidia: {
    id: 'nvidia',
    name: 'nvidia',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://integrate.api.nvidia.com',
    models: SYSTEM_MODELS.nvidia,
    isSystem: true,
    enabled: false
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.x.ai',
    models: SYSTEM_MODELS.grok,
    isSystem: true,
    enabled: false
  },
  hyperbolic: {
    id: 'hyperbolic',
    name: 'Hyperbolic',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.hyperbolic.xyz',
    models: SYSTEM_MODELS.hyperbolic,
    isSystem: true,
    enabled: false
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.mistral.ai',
    models: SYSTEM_MODELS.mistral,
    isSystem: true,
    enabled: false
  },
  jina: {
    id: 'jina',
    name: 'Jina',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.jina.ai',
    models: SYSTEM_MODELS.jina,
    isSystem: true,
    enabled: false
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.perplexity.ai/',
    models: SYSTEM_MODELS.perplexity,
    isSystem: true,
    enabled: false
  },
  modelscope: {
    id: 'modelscope',
    name: 'ModelScope',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api-inference.modelscope.cn/v1/',
    models: SYSTEM_MODELS.modelscope,
    isSystem: true,
    enabled: false
  },
  xirang: {
    id: 'xirang',
    name: 'Xirang',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://wishub-x1.ctyun.cn',
    models: SYSTEM_MODELS.xirang,
    isSystem: true,
    enabled: false
  },
  hunyuan: {
    id: 'hunyuan',
    name: 'hunyuan',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.hunyuan.cloud.tencent.com',
    models: SYSTEM_MODELS.hunyuan,
    isSystem: true,
    enabled: false
  },
  'tencent-cloud-ti': {
    id: 'tencent-cloud-ti',
    name: 'Tencent Cloud TI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.lkeap.cloud.tencent.com',
    models: SYSTEM_MODELS['tencent-cloud-ti'],
    isSystem: true,
    enabled: false
  },
  'baidu-cloud': {
    id: 'baidu-cloud',
    name: 'Baidu Cloud',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://qianfan.baidubce.com/v2/',
    models: SYSTEM_MODELS['baidu-cloud'],
    isSystem: true,
    enabled: false
  },
  gpustack: {
    id: 'gpustack',
    name: 'GPUStack',
    type: 'openai',
    apiKey: '',
    apiHost: '',
    models: SYSTEM_MODELS.gpustack,
    isSystem: true,
    enabled: false
  },
  voyageai: {
    id: 'voyageai',
    name: 'VoyageAI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.voyageai.com',
    models: SYSTEM_MODELS.voyageai,
    isSystem: true,
    enabled: false
  },
  'aws-bedrock': {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    type: 'aws-bedrock',
    apiKey: '',
    apiHost: '',
    models: SYSTEM_MODELS['aws-bedrock'],
    isSystem: true,
    enabled: false
  },
  poe: {
    id: 'poe',
    name: 'Poe',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.poe.com/v1/',
    models: SYSTEM_MODELS['poe'],
    isSystem: true,
    enabled: false
  },
  aionly: {
    id: 'aionly',
    name: 'AIOnly',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.aiionly.com',
    models: SYSTEM_MODELS.aionly,
    isSystem: true,
    enabled: false
  }
} as const

export const SYSTEM_PROVIDERS: SystemProvider[] = Object.values(SYSTEM_PROVIDERS_CONFIG)

export const PROVIDER_LOGO_MAP: AtLeast<SystemProviderId, string> = {
  cherryin: CherryInProviderLogo,
  ph8: Ph8ProviderLogo,
  '302ai': Ai302ProviderLogo,
  openai: OpenAiProviderLogo,
  silicon: SiliconFlowProviderLogo,
  deepseek: DeepSeekProviderLogo,
  'gitee-ai': GiteeAIProviderLogo,
  yi: ZeroOneProviderLogo,
  groq: GroqProviderLogo,
  zhipu: ZhipuProviderLogo,
  ollama: OllamaProviderLogo,
  lmstudio: LMStudioProviderLogo,
  moonshot: MoonshotProviderLogo,
  openrouter: OpenRouterProviderLogo,
  baichuan: BaichuanProviderLogo,
  dashscope: BailianProviderLogo,
  modelscope: ModelScopeProviderLogo,
  xirang: XirangProviderLogo,
  anthropic: AnthropicProviderLogo,
  aihubmix: AiHubMixProviderLogo,
  burncloud: BurnCloudProviderLogo,
  gemini: GoogleProviderLogo,
  stepfun: StepProviderLogo,
  doubao: BytedanceProviderLogo,
  minimax: MinimaxProviderLogo,
  github: GithubProviderLogo,
  copilot: GithubProviderLogo,
  ocoolai: OcoolAiProviderLogo,
  together: TogetherProviderLogo,
  fireworks: FireworksProviderLogo,
  zhinao: ZhinaoProviderLogo,
  nvidia: NvidiaProviderLogo,
  'azure-openai': AzureProviderLogo,
  hunyuan: HunyuanProviderLogo,
  grok: GrokProviderLogo,
  hyperbolic: HyperbolicProviderLogo,
  mistral: MistralProviderLogo,
  jina: JinaProviderLogo,
  ppio: PPIOProviderLogo,
  'baidu-cloud': BaiduCloudProviderLogo,
  dmxapi: DmxapiProviderLogo,
  perplexity: PerplexityProviderLogo,
  infini: InfiniProviderLogo,
  o3: O3ProviderLogo,
  'tencent-cloud-ti': TencentCloudProviderLogo,
  gpustack: GPUStackProviderLogo,
  alayanew: AlayaNewProviderLogo,
  voyageai: VoyageAIProviderLogo,
  qiniu: QiniuProviderLogo,
  tokenflux: TokenFluxProviderLogo,
  cephalon: CephalonProviderLogo,
  lanyun: LanyunProviderLogo,
  vertexai: VertexAIProviderLogo,
  'new-api': NewAPIProviderLogo,
  'aws-bedrock': AwsProviderLogo,
  poe: 'svg', // use svg icon component
  aionly: AiOnlyProviderLogo
} as const

export function getProviderLogo(providerId: string) {
  return PROVIDER_LOGO_MAP[providerId as keyof typeof PROVIDER_LOGO_MAP]
}

// export const SUPPORTED_REANK_PROVIDERS = ['silicon', 'jina', 'voyageai', 'dashscope', 'aihubmix']
export const NOT_SUPPORTED_RERANK_PROVIDERS = ['ollama', 'lmstudio'] as const satisfies SystemProviderId[]
export const ONLY_SUPPORTED_DIMENSION_PROVIDERS = ['ollama', 'infini'] as const satisfies SystemProviderId[]

type ProviderUrls = {
  api: {
    url: string
  }
  websites?: {
    official: string
    apiKey?: string
    docs: string
    models?: string
  }
}

export const PROVIDER_URLS: Record<SystemProviderId, ProviderUrls> = {
  cherryin: {
    api: {
      url: 'https://api.cherry-ai.com'
    },
    websites: {
      official: 'https://cherry-ai.com',
      docs: 'https://docs.cherry-ai.com',
      models: 'https://docs.cherry-ai.com/pre-basic/providers/cherryin'
    }
  },
  ph8: {
    api: {
      url: 'https://ph8.co'
    },
    websites: {
      official: 'https://ph8.co',
      apiKey: 'https://ph8.co/apiKey',
      docs: 'https://m1r239or5aw.feishu.cn/wiki/SegzwS4x1i2P4OksFY2cMvujn9f',
      models: 'https://ph8.co/v1/models'
    }
  },
  '302ai': {
    api: {
      url: 'https://api.302.ai'
    },
    websites: {
      official: 'https://302.ai',
      apiKey: 'https://dash.302.ai/apis/list',
      docs: 'https://302ai.apifox.cn/api-147522039',
      models: 'https://302.ai/pricing/'
    }
  },
  openai: {
    api: {
      url: 'https://api.openai.com'
    },
    websites: {
      official: 'https://openai.com/',
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      models: 'https://platform.openai.com/docs/models'
    }
  },
  burncloud: {
    api: {
      url: 'https://ai.burncloud.com'
    },
    websites: {
      official: 'https://ai.burncloud.com/',
      apiKey: 'https://ai.burncloud.com/token',
      docs: 'https://ai.burncloud.com/docs',
      models: 'https://ai.burncloud.com/pricing'
    }
  },
  ppio: {
    api: {
      url: 'https://api.ppinfra.com/v3/openai'
    },
    websites: {
      official: 'https://ppio.com/user/register?invited_by=JYT9GD&utm_source=github_cherry-studio&redirect=/',
      apiKey:
        'https://ppio.com/user/register?invited_by=JYT9GD&utm_source=github_cherry-studio&redirect=/settings/key-management',
      docs: 'https://docs.cherry-ai.com/pre-basic/providers/ppio?invited_by=JYT9GD&utm_source=github_cherry-studio',
      models: 'https://ppio.com/model-api/product/llm-api?invited_by=JYT9GD&utm_source=github_cherry-studio'
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
    }
  },
  silicon: {
    api: {
      url: 'https://api.siliconflow.cn'
    },
    websites: {
      official: 'https://www.siliconflow.cn',
      apiKey: 'https://cloud.siliconflow.cn/i/d1nTBKXU',
      docs: 'https://docs.siliconflow.cn/',
      models: 'https://cloud.siliconflow.cn/models'
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
    }
  },
  ocoolai: {
    api: {
      url: 'https://api.ocoolai.com'
    },
    websites: {
      official: 'https://one.ocoolai.com/',
      apiKey: 'https://one.ocoolai.com/token',
      docs: 'https://docs.ocoolai.com/',
      models: 'https://api.ocoolai.com/info/models/'
    }
  },
  together: {
    api: {
      url: 'https://api.together.xyz'
    },
    websites: {
      official: 'https://www.together.ai/',
      apiKey: 'https://api.together.ai/settings/api-keys',
      docs: 'https://docs.together.ai/docs/introduction',
      models: 'https://docs.together.ai/docs/chat-models'
    }
  },
  dmxapi: {
    api: {
      url: 'https://www.dmxapi.cn'
    },
    websites: {
      official: 'https://www.dmxapi.cn/register?aff=bwwY',
      apiKey: 'https://www.dmxapi.cn/register?aff=bwwY',
      docs: 'https://dmxapi.cn/models.html#code-block',
      models: 'https://www.dmxapi.cn/pricing'
    }
  },
  perplexity: {
    api: {
      url: 'https://api.perplexity.ai/'
    },
    websites: {
      official: 'https://perplexity.ai/',
      apiKey: 'https://www.perplexity.ai/settings/api',
      docs: 'https://docs.perplexity.ai/home',
      models: 'https://docs.perplexity.ai/guides/model-cards'
    }
  },
  infini: {
    api: {
      url: 'https://cloud.infini-ai.com/maas'
    },
    websites: {
      official: 'https://cloud.infini-ai.com/',
      apiKey: 'https://cloud.infini-ai.com/iam/secret/key',
      docs: 'https://docs.infini-ai.com/gen-studio/api/maas.html#/operations/chatCompletions',
      models: 'https://cloud.infini-ai.com/genstudio/model'
    }
  },
  github: {
    api: {
      url: 'https://models.github.ai/inference/'
    },
    websites: {
      official: 'https://github.com/marketplace/models',
      apiKey: 'https://github.com/settings/tokens',
      docs: 'https://docs.github.com/en/github-models',
      models: 'https://github.com/marketplace/models'
    }
  },
  copilot: {
    api: {
      url: 'https://api.githubcopilot.com/'
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
    }
  },
  zhipu: {
    api: {
      url: 'https://open.bigmodel.cn/api/paas/v4/'
    },
    websites: {
      official: 'https://open.bigmodel.cn/',
      apiKey: 'https://open.bigmodel.cn/usercenter/apikeys',
      docs: 'https://docs.bigmodel.cn/',
      models: 'https://open.bigmodel.cn/modelcenter/square'
    }
  },
  moonshot: {
    api: {
      url: 'https://api.moonshot.cn'
    },
    websites: {
      official: 'https://www.moonshot.cn/',
      apiKey: 'https://platform.moonshot.cn/console/api-keys',
      docs: 'https://platform.moonshot.cn/docs/',
      models: 'https://platform.moonshot.cn/docs/intro#%E6%A8%A1%E5%9E%8B%E5%88%97%E8%A1%A8'
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
    }
  },
  modelscope: {
    api: {
      url: 'https://api-inference.modelscope.cn/v1/'
    },
    websites: {
      official: 'https://modelscope.cn',
      apiKey: 'https://modelscope.cn/my/myaccesstoken',
      docs: 'https://modelscope.cn/docs/model-service/API-Inference/intro',
      models: 'https://modelscope.cn/models'
    }
  },
  xirang: {
    api: {
      url: 'https://wishub-x1.ctyun.cn'
    },
    websites: {
      official: 'https://www.ctyun.cn',
      apiKey: 'https://huiju.ctyun.cn/service/serviceGroup',
      docs: 'https://www.ctyun.cn/products/ctxirang',
      models: 'https://huiju.ctyun.cn/modelSquare/'
    }
  },
  dashscope: {
    api: {
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/'
    },
    websites: {
      official: 'https://www.aliyun.com/product/bailian',
      apiKey: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
      docs: 'https://help.aliyun.com/zh/model-studio/getting-started/',
      models: 'https://bailian.console.aliyun.com/?tab=model#/model-market'
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
    }
  },
  doubao: {
    api: {
      url: 'https://ark.cn-beijing.volces.com/api/v3/'
    },
    websites: {
      official: 'https://console.volcengine.com/ark/',
      apiKey: 'https://www.volcengine.com/experience/ark?utm_term=202502dsinvite&ac=DSASUQY5&rc=DB4II4FC',
      docs: 'https://www.volcengine.com/docs/82379/1182403',
      models: 'https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint'
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
    }
  },
  alayanew: {
    api: {
      url: 'https://deepseek.alayanew.com'
    },
    websites: {
      official: 'https://www.alayanew.com/backend/register?id=cherrystudio',
      apiKey: ' https://www.alayanew.com/backend/register?id=cherrystudio',
      docs: 'https://docs.alayanew.com/docs/modelService/interview?utm_source=cherrystudio',
      models: 'https://www.alayanew.com/product/deepseek?id=cherrystudio'
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
      models: 'https://openrouter.ai/models'
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
    }
  },
  ollama: {
    api: {
      url: 'http://localhost:11434'
    },
    websites: {
      official: 'https://ollama.com/',
      docs: 'https://github.com/ollama/ollama/tree/main/docs',
      models: 'https://ollama.com/library'
    }
  },
  lmstudio: {
    api: {
      url: 'http://localhost:1234'
    },
    websites: {
      official: 'https://lmstudio.ai/',
      docs: 'https://lmstudio.ai/docs',
      models: 'https://lmstudio.ai/models'
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
    }
  },
  grok: {
    api: {
      url: 'https://api.x.ai'
    },
    websites: {
      official: 'https://x.ai/',
      docs: 'https://docs.x.ai/',
      models: 'https://docs.x.ai/docs/models'
    }
  },
  hyperbolic: {
    api: {
      url: 'https://api.hyperbolic.xyz'
    },
    websites: {
      official: 'https://app.hyperbolic.xyz',
      apiKey: 'https://app.hyperbolic.xyz/settings',
      docs: 'https://docs.hyperbolic.xyz',
      models: 'https://app.hyperbolic.xyz/models'
    }
  },
  mistral: {
    api: {
      url: 'https://api.mistral.ai'
    },
    websites: {
      official: 'https://mistral.ai',
      apiKey: 'https://console.mistral.ai/api-keys/',
      docs: 'https://docs.mistral.ai',
      models: 'https://docs.mistral.ai/getting-started/models/models_overview'
    }
  },
  jina: {
    api: {
      url: 'https://api.jina.ai'
    },
    websites: {
      official: 'https://jina.ai',
      apiKey: 'https://jina.ai/',
      docs: 'https://jina.ai',
      models: 'https://jina.ai'
    }
  },
  aihubmix: {
    api: {
      url: 'https://aihubmix.com'
    },
    websites: {
      official: 'https://aihubmix.com?aff=SJyh',
      apiKey: 'https://aihubmix.com?aff=SJyh',
      docs: 'https://doc.aihubmix.com/',
      models: 'https://aihubmix.com/models'
    }
  },
  fireworks: {
    api: {
      url: 'https://api.fireworks.ai/inference'
    },
    websites: {
      official: 'https://fireworks.ai/',
      apiKey: 'https://fireworks.ai/account/api-keys',
      docs: 'https://docs.fireworks.ai/getting-started/introduction',
      models: 'https://fireworks.ai/dashboard/models'
    }
  },
  hunyuan: {
    api: {
      url: 'https://api.hunyuan.cloud.tencent.com'
    },
    websites: {
      official: 'https://cloud.tencent.com/product/hunyuan',
      apiKey: 'https://console.cloud.tencent.com/hunyuan/api-key',
      docs: 'https://cloud.tencent.com/document/product/1729/111007',
      models: 'https://cloud.tencent.com/document/product/1729/104753'
    }
  },
  nvidia: {
    api: {
      url: 'https://integrate.api.nvidia.com'
    },
    websites: {
      official: 'https://build.nvidia.com/explore/discover',
      apiKey: 'https://build.nvidia.com/meta/llama-3_1-405b-instruct',
      docs: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
      models: 'https://build.nvidia.com/nim'
    }
  },
  'azure-openai': {
    api: {
      url: ''
    },
    websites: {
      official: 'https://azure.microsoft.com/en-us/products/ai-services/openai-service',
      apiKey: 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI',
      docs: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
      models: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models'
    }
  },
  'baidu-cloud': {
    api: {
      url: 'https://qianfan.baidubce.com/v2/'
    },
    websites: {
      official: 'https://cloud.baidu.com/',
      apiKey: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
      docs: 'https://cloud.baidu.com/doc/index.html',
      models: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Fm2vrveyu'
    }
  },
  'tencent-cloud-ti': {
    api: {
      url: 'https://api.lkeap.cloud.tencent.com'
    },
    websites: {
      official: 'https://cloud.tencent.com/product/ti',
      apiKey: 'https://console.cloud.tencent.com/lkeap/api',
      docs: 'https://cloud.tencent.com/document/product/1772',
      models: 'https://console.cloud.tencent.com/tione/v2/aimarket'
    }
  },
  gpustack: {
    api: {
      url: ''
    },
    websites: {
      official: 'https://gpustack.ai/',
      docs: 'https://docs.gpustack.ai/latest/',
      models: 'https://docs.gpustack.ai/latest/overview/#supported-models'
    }
  },
  voyageai: {
    api: {
      url: 'https://api.voyageai.com'
    },
    websites: {
      official: 'https://www.voyageai.com/',
      apiKey: 'https://dashboard.voyageai.com/organization/api-keys',
      docs: 'https://docs.voyageai.com/docs',
      models: 'https://docs.voyageai.com/docs'
    }
  },
  qiniu: {
    api: {
      url: 'https://api.qnaigc.com'
    },
    websites: {
      official: 'https://qiniu.com',
      apiKey: 'https://portal.qiniu.com/ai-inference/api-key?cps_key=1h4vzfbkxobiq',
      docs: 'https://developer.qiniu.com/aitokenapi',
      models: 'https://developer.qiniu.com/aitokenapi/12883/model-list'
    }
  },
  tokenflux: {
    api: {
      url: TOKENFLUX_HOST
    },
    websites: {
      official: TOKENFLUX_HOST,
      apiKey: `${TOKENFLUX_HOST}/dashboard/api-keys`,
      docs: `${TOKENFLUX_HOST}/docs`,
      models: `${TOKENFLUX_HOST}/models`
    }
  },
  cephalon: {
    api: {
      url: 'https://cephalon.cloud/user-center/v1/model'
    },
    websites: {
      official: 'https://cephalon.cloud/share/register-landing?invite_id=jSdOYA',
      apiKey: 'https://cephalon.cloud/api',
      docs: 'https://cephalon.cloud/apitoken/1864244127731589124',
      models: 'https://cephalon.cloud/model'
    }
  },
  lanyun: {
    api: {
      url: 'https://maas-api.lanyun.net'
    },
    websites: {
      official: 'https://maas.lanyun.net',
      apiKey: 'https://maas.lanyun.net/#/system/apiKey',
      docs: 'https://archive.lanyun.net/#/maas/',
      models: 'https://maas.lanyun.net/#/model/modelSquare'
    }
  },
  vertexai: {
    api: {
      url: 'https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/overview'
    },
    websites: {
      official: 'https://cloud.google.com/vertex-ai',
      apiKey: 'https://console.cloud.google.com/apis/credentials',
      docs: 'https://cloud.google.com/vertex-ai/generative-ai/docs',
      models: 'https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models'
    }
  },
  'new-api': {
    api: {
      url: 'http://localhost:3000'
    },
    websites: {
      official: 'https://docs.newapi.pro/',
      docs: 'https://docs.newapi.pro'
    }
  },
  'aws-bedrock': {
    api: {
      url: ''
    },
    websites: {
      official: 'https://aws.amazon.com/bedrock/',
      apiKey: 'https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html',
      docs: 'https://docs.aws.amazon.com/bedrock/',
      models: 'https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html'
    }
  },
  poe: {
    api: {
      url: 'https://api.poe.com/v1/'
    },
    websites: {
      official: 'https://poe.com/',
      apiKey: 'https://poe.com/api_key',
      docs: 'https://creator.poe.com/docs/external-applications/openai-compatible-api',
      models: 'https://poe.com/'
    }
  },
  aionly: {
    api: {
      url: 'https://api.aiionly.com'
    },
    websites: {
      official: 'https://www.aiionly.com',
      apiKey: 'https://www.aiionly.com/keyApi',
      docs: 'https://www.aiionly.com/document',
      models: 'https://www.aiionly.com'
    }
  }
}

const NOT_SUPPORT_ARRAY_CONTENT_PROVIDERS = [
  'deepseek',
  'baichuan',
  'minimax',
  'xirang',
  'poe'
] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 message 的 content 为数组类型。 Only for OpenAI Chat Completions API.
 */
export const isSupportArrayContentProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportArrayContent !== true &&
    !NOT_SUPPORT_ARRAY_CONTENT_PROVIDERS.some((pid) => pid === provider.id)
  )
}

const NOT_SUPPORT_DEVELOPER_ROLE_PROVIDERS = ['poe', 'qiniu'] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 developer 作为 message role。 Only for OpenAI API.
 */
export const isSupportDeveloperRoleProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isSupportDeveloperRole === true ||
    (isSystemProvider(provider) && !NOT_SUPPORT_DEVELOPER_ROLE_PROVIDERS.some((pid) => pid === provider.id))
  )
}

const NOT_SUPPORT_STREAM_OPTIONS_PROVIDERS = ['mistral'] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 stream_options 参数。Only for OpenAI API.
 */
export const isSupportStreamOptionsProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportStreamOptions !== true &&
    !NOT_SUPPORT_STREAM_OPTIONS_PROVIDERS.some((pid) => pid === provider.id)
  )
}

const NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDER = [
  'ollama',
  'lmstudio',
  'nvidia'
] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持使用 enable_thinking 参数来控制 Qwen3 等模型的思考。 Only for OpenAI Chat Completions API.
 */
export const isSupportEnableThinkingProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isNotSupportEnableThinking !== true &&
    !NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDER.some((pid) => pid === provider.id)
  )
}

const NOT_SUPPORT_SERVICE_TIER_PROVIDERS = ['github', 'copilot'] as const satisfies SystemProviderId[]

/**
 * 判断提供商是否支持 service_tier 设置。 Only for OpenAI API.
 */
export const isSupportServiceTierProvider = (provider: Provider) => {
  return (
    provider.apiOptions?.isSupportServiceTier === true ||
    (isSystemProvider(provider) && !NOT_SUPPORT_SERVICE_TIER_PROVIDERS.some((pid) => pid === provider.id))
  )
}

const SUPPORT_GEMINI_URL_CONTEXT_PROVIDER_TYPES = ['gemini', 'vertexai'] as const satisfies ProviderType[]

export const isSupportUrlContextProvider = (provider: Provider) => {
  return SUPPORT_GEMINI_URL_CONTEXT_PROVIDER_TYPES.some((type) => type === provider.type)
}

const SUPPORT_GEMINI_NATIVE_WEB_SEARCH_PROVIDERS = ['gemini', 'vertexai'] as const satisfies SystemProviderId[]

/** 判断是否是使用 Gemini 原生搜索工具的 provider. 目前假设只有官方 API 使用原生工具 */
export const isGeminiWebSearchProvider = (provider: Provider) => {
  return SUPPORT_GEMINI_NATIVE_WEB_SEARCH_PROVIDERS.some((id) => id === provider.id)
}
