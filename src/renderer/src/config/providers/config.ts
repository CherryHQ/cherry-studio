import type { SystemProvider, SystemProviderId } from '@renderer/types'

import { qwenModel, SYSTEM_MODELS } from '../models'

export const CHERRYAI_PROVIDER: SystemProvider = {
  id: 'cherryai' as SystemProviderId,
  name: 'CherryAI',
  type: 'openai',
  apiKey: '',
  apiHost: 'https://api.cherry-ai.com',
  models: [qwenModel],
  isSystem: true,
  enabled: true
}

export const SYSTEM_PROVIDERS_CONFIG: Record<SystemProviderId, SystemProvider> = {
  cherryin: {
    id: 'cherryin',
    name: 'CherryIN',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://open.cherryin.cc',
    anthropicApiHost: 'https://open.cherryin.cc',
    models: [],
    isSystem: true,
    enabled: true
  },
  silicon: {
    id: 'silicon',
    name: 'Silicon',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.siliconflow.cn',
    anthropicApiHost: 'https://api.siliconflow.cn',
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
    anthropicApiHost: 'https://aihubmix.com',
    models: SYSTEM_MODELS.aihubmix,
    isSystem: true,
    enabled: false
  },
  ovms: {
    id: 'ovms',
    name: 'OpenVINO Model Server',
    type: 'openai',
    apiKey: '',
    apiHost: 'http://localhost:8000/v3/',
    models: SYSTEM_MODELS.ovms,
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
    anthropicApiHost: 'https://open.bigmodel.cn/api/anthropic',
    models: SYSTEM_MODELS.zhipu,
    isSystem: true,
    enabled: false
  },
  zai: {
    id: 'zai',
    name: 'Z.ai',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.z.ai/api/paas/v4/',
    anthropicApiHost: 'https://api.z.ai/api/anthropic',
    models: SYSTEM_MODELS.zai,
    isSystem: true,
    enabled: false
  },
  deepseek: {
    id: 'deepseek',
    name: 'deepseek',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.deepseek.com',
    anthropicApiHost: 'https://api.deepseek.com/anthropic',
    models: SYSTEM_MODELS.deepseek,
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
  dmxapi: {
    id: 'dmxapi',
    name: 'DMXAPI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://www.dmxapi.cn',
    anthropicApiHost: 'https://www.dmxapi.cn',
    models: SYSTEM_MODELS.dmxapi,
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
    apiHost: 'https://api.tokenflux.ai/openai/v1',
    anthropicApiHost: 'https://api.tokenflux.ai/anthropic',
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
    anthropicApiHost: 'https://api.302.ai',
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
  sophnet: {
    id: 'sophnet',
    name: 'SophNet',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://www.sophnet.com/api/open-apis/v1',
    models: [],
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
  dashscope: {
    id: 'dashscope',
    name: 'Bailian',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
    anthropicApiHost: 'https://dashscope.aliyuncs.com/apps/anthropic',
    models: SYSTEM_MODELS.dashscope,
    isSystem: true,
    enabled: false
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.minimaxi.com/v1/',
    anthropicApiHost: 'https://api.minimaxi.com/anthropic',
    models: SYSTEM_MODELS.minimax,
    isSystem: true,
    enabled: false
  },
  'minimax-global': {
    id: 'minimax-global',
    name: 'MiniMax Global',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.minimax.io/v1/',
    anthropicApiHost: 'https://api.minimax.io/anthropic',
    models: SYSTEM_MODELS['minimax-global'],
    isSystem: true,
    enabled: false
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot AI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.moonshot.cn',
    anthropicApiHost: 'https://api.moonshot.cn/anthropic',
    models: SYSTEM_MODELS.moonshot,
    isSystem: true,
    enabled: false
  },
  qiniu: {
    id: 'qiniu',
    name: 'Qiniu',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.qnaigc.com',
    anthropicApiHost: 'https://api.qnaigc.com',
    models: SYSTEM_MODELS.qiniu,
    isSystem: true,
    enabled: false
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://openrouter.ai/api/v1/',
    // Anthropic-compatible endpoint for Agent mode (Claude Code SDK)
    // https://openrouter.ai/docs/guides/guides/coding-agents/claude-code-integration
    anthropicApiHost: 'https://openrouter.ai/api',
    models: SYSTEM_MODELS.openrouter,
    isSystem: true,
    enabled: false
  },
  'new-api': {
    id: 'new-api',
    name: 'New API',
    type: 'new-api',
    apiKey: '',
    apiHost: 'http://localhost:3000',
    anthropicApiHost: 'http://localhost:3000',
    models: SYSTEM_MODELS['new-api'],
    isSystem: true,
    enabled: false
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    type: 'ollama',
    apiKey: '',
    apiHost: 'http://localhost:11434',
    anthropicApiHost: 'http://localhost:11434',
    models: SYSTEM_MODELS.ollama,
    isSystem: true,
    enabled: false
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio',
    type: 'openai',
    apiKey: '',
    apiHost: 'http://localhost:1234',
    anthropicApiHost: 'http://localhost:1234',
    models: SYSTEM_MODELS.lmstudio,
    isSystem: true,
    enabled: false
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    apiKey: '',
    apiHost: 'https://api.anthropic.com',
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
    apiHost: '',
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
  stepfun: {
    id: 'stepfun',
    name: 'StepFun',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.stepfun.com',
    anthropicApiHost: 'https://api.stepfun.com',
    models: SYSTEM_MODELS.stepfun,
    isSystem: true,
    enabled: false
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
    anthropicApiHost: 'https://api-inference.modelscope.cn',
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
  longcat: {
    id: 'longcat',
    name: 'LongCat',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.longcat.chat/openai',
    anthropicApiHost: 'https://api.longcat.chat/anthropic',
    models: SYSTEM_MODELS.longcat,
    isSystem: true,
    enabled: false
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    type: 'openai-response',
    apiKey: '',
    apiHost: 'https://router.huggingface.co/v1/',
    models: [],
    isSystem: true,
    enabled: false
  },
  gateway: {
    id: 'gateway',
    name: 'Vercel AI Gateway',
    type: 'gateway',
    apiKey: '',
    apiHost: 'https://ai-gateway.vercel.sh/v1/ai',
    models: [],
    isSystem: true,
    enabled: false
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras AI',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.cerebras.ai/v1',
    models: SYSTEM_MODELS.cerebras,
    isSystem: true,
    enabled: false
  },
  mimo: {
    id: 'mimo',
    name: 'Xiaomi MiMo',
    type: 'openai',
    apiKey: '',
    apiHost: 'https://api.xiaomimimo.com',
    anthropicApiHost: 'https://api.xiaomimimo.com/anthropic',
    models: SYSTEM_MODELS.mimo,
    isSystem: true,
    enabled: false
  }
} as const


export const SYSTEM_PROVIDERS: SystemProvider[] = Object.values(SYSTEM_PROVIDERS_CONFIG)
