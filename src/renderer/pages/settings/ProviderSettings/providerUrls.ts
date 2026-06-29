import type { SystemProviderId } from '@renderer/types/provider'
import { TOKENFLUX_HOST } from '@renderer/utils/oauth'

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
      url: 'https://open.cherryin.net'
    },
    websites: {
      official: 'https://open.cherryin.ai',
      apiKey: 'https://open.cherryin.ai/console/token',
      docs: 'https://open.cherryin.ai',
      models: 'https://open.cherryin.ai/pricing'
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
  sophnet: {
    api: {
      url: 'https://www.sophnet.com/api/open-apis/v1'
    },
    websites: {
      official: 'https://sophnet.com',
      apiKey: 'https://sophnet.com/#/project/key',
      docs: 'https://sophnet.com/docs/component/introduce.html',
      models: 'https://sophnet.com/#/model/list'
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
      models: 'https://docs.together.ai/docs/serverless-models'
    }
  },
  dmxapi: {
    api: {
      url: 'https://www.dmxapi.cn'
    },
    websites: {
      official: 'https://www.dmxapi.cn/register?aff=bwwY',
      apiKey: 'https://www.dmxapi.cn/register?aff=bwwY',
      docs: 'https://doc.dmxapi.cn/',
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
      apiKey: 'https://open.bigmodel.cn/apikey/platform',
      docs: 'https://docs.bigmodel.cn/',
      models: 'https://open.bigmodel.cn/modelcenter/square'
    }
  },
  zai: {
    api: {
      url: 'https://api.z.ai/api/paas/v4/'
    },
    websites: {
      official: 'https://z.ai',
      apiKey: 'https://z.ai/manage-apikey/apikey-list',
      docs: 'https://docs.z.ai/',
      models: 'https://docs.z.ai/models'
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
      models: 'https://platform.baichuan-ai.com/prices'
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
      docs: 'https://platform.stepfun.com/docs/api-reference/chat/chat-completion-create',
      models: 'https://platform.stepfun.com/docs/guides/models/overview'
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
      url: 'https://api.minimaxi.com/v1/'
    },
    websites: {
      official: 'https://platform.minimaxi.com/',
      apiKey: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      docs: 'https://platform.minimaxi.com/docs/api-reference/text-openai-api',
      models: 'https://platform.minimaxi.com/document/Models'
    }
  },
  'minimax-global': {
    api: {
      url: 'https://api.minimax.io/v1/'
    },
    websites: {
      official: 'https://platform.minimax.io/',
      apiKey: 'https://platform.minimax.io/user-center/basic-information/interface-key',
      docs: 'https://platform.minimax.io/docs/api-reference/text-openai-api',
      models: 'https://platform.minimax.io/document/Models'
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
  ovms: {
    api: {
      url: 'http://localhost:8000/v3/'
    },
    websites: {
      official: 'https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/overview.html',
      docs: 'https://docs.openvino.ai/2025/model-server/ovms_what_is_openvino_model_server.html',
      models: 'https://www.modelscope.cn/organization/OpenVINO'
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
      url: 'https://api.anthropic.com'
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
      url: 'https://tokenhub.tencentmaas.com/v1'
    },
    websites: {
      official: 'https://cloud.tencent.com/product/hunyuan',
      apiKey: 'https://console.cloud.tencent.com/hunyuan/api-key',
      docs: 'https://cloud.tencent.com/document/product/1823/130058',
      models: 'https://cloud.tencent.com/document/product/1823/130051'
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
      url: ''
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
      apiKey: 'https://poe.com/api/keys',
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
      apiKey: 'https://maas.aiionly.com/keyApi',
      docs: 'https://maas.aiionly.com/document',
      models: 'https://maas.aiionly.com'
    }
  },
  longcat: {
    api: {
      url: 'https://api.longcat.chat/openai'
    },
    websites: {
      official: 'https://longcat.chat',
      apiKey: 'https://longcat.chat/platform/api_keys',
      docs: 'https://longcat.chat/platform/docs/zh/',
      models: 'https://longcat.chat/platform/docs/zh/APIDocs.html'
    }
  },
  huggingface: {
    api: {
      url: 'https://router.huggingface.co/v1/'
    },
    websites: {
      official: 'https://huggingface.co/',
      apiKey: 'https://huggingface.co/settings/tokens',
      docs: 'https://huggingface.co/docs',
      models: 'https://huggingface.co/models'
    }
  },
  gateway: {
    api: {
      url: 'https://ai-gateway.vercel.sh/v1/ai'
    },
    websites: {
      official: 'https://vercel.com/ai-gateway',
      apiKey: 'https://vercel.com/',
      docs: 'https://vercel.com/docs/ai-gateway',
      models: 'https://vercel.com/ai-gateway/models'
    }
  },
  cerebras: {
    api: {
      url: 'https://api.cerebras.ai/v1'
    },
    websites: {
      official: 'https://www.cerebras.ai',
      apiKey: 'https://cloud.cerebras.ai',
      docs: 'https://inference-docs.cerebras.ai/introduction',
      models: 'https://inference-docs.cerebras.ai/models/overview'
    }
  },
  mimo: {
    api: {
      url: 'https://api.xiaomimimo.com'
    },
    websites: {
      official: 'https://platform.xiaomimimo.com/',
      apiKey: 'https://platform.xiaomimimo.com/#/console/usage',
      docs: 'https://platform.xiaomimimo.com/#/docs/welcome',
      models: 'https://platform.xiaomimimo.com/'
    }
  }
}
