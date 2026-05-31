import type { Model, SystemProviderId } from '@renderer/types'

export const qwenModel: Model = {
  id: 'qwen',
  name: 'Qwen',
  provider: 'cherryai',
  group: 'Qwen'
}

import { _302aiModels } from './302ai'
import { aihubmixModels } from './aihubmix'
import { aionlyModels } from './aionly'
import { alayanewModels } from './alayanew'
import { anthropicModels } from './anthropic'
import { aws_bedrockModels } from './aws-bedrock'
import { azure_openaiModels } from './azure-openai'
import { baichuanModels } from './baichuan'
import { baidu_cloudModels } from './baidu-cloud'
import { burncloudModels } from './burncloud'
import { cephalonModels } from './cephalon'
import { cerebrasModels } from './cerebras'
import { cherryinModels } from './cherryin'
import { copilotModels } from './copilot'
import { dashscopeModels } from './dashscope'
import { deepseekModels } from './deepseek'
import { dmxapiModels } from './dmxapi'
import { doubaoModels } from './doubao'
import { fireworksModels } from './fireworks'
import { gatewayModels } from './gateway'
import { geminiModels } from './gemini'
import { githubModels } from './github'
import { gpustackModels } from './gpustack'
import { grokModels } from './grok'
import { groqModels } from './groq'
import { huggingfaceModels } from './huggingface'
import { hunyuanModels } from './hunyuan'
import { hyperbolicModels } from './hyperbolic'
import { infiniModels } from './infini'
import { jinaModels } from './jina'
import { lanyunModels } from './lanyun'
import { lmstudioModels } from './lmstudio'
import { longcatModels } from './longcat'
import { mimoModels } from './mimo'
import { minimaxModels } from './minimax'
import { minimax_globalModels } from './minimax-global'
import { mistralModels } from './mistral'
import { modelscopeModels } from './modelscope'
import { moonshotModels } from './moonshot'
import { new_apiModels } from './new-api'
import { nvidiaModels } from './nvidia'
import { ocoolaiModels } from './ocoolai'
import { ollamaModels } from './ollama'
import { openaiModels } from './openai'
import { openrouterModels } from './openrouter'
import { ovmsModels } from './ovms'
import { perplexityModels } from './perplexity'
import { ph8Models } from './ph8'
import { poeModels } from './poe'
import { ppioModels } from './ppio'
import { qiniuModels } from './qiniu'
import { siliconModels } from './silicon'
import { sophnetModels } from './sophnet'
import { stepfunModels } from './stepfun'
import { tencent_cloud_tiModels } from './tencent-cloud-ti'
import { togetherModels } from './together'
import { tokenfluxModels } from './tokenflux'
import { vertexaiModels } from './vertexai'
import { voyageaiModels } from './voyageai'
import { xirangModels } from './xirang'
import { yiModels } from './yi'
import { zaiModels } from './zai'
import { zhipuModels } from './zhipu'

export const SYSTEM_MODELS: Record<SystemProviderId | 'defaultModel', Model[]> = {
  defaultModel: [qwenModel, qwenModel, qwenModel, qwenModel],
  cherryin: cherryinModels,
  vertexai: vertexaiModels,
  sophnet: sophnetModels,
  '302ai': _302aiModels,
  ph8: ph8Models,
  aihubmix: aihubmixModels,
  burncloud: burncloudModels,
  ovms: ovmsModels,
  ollama: ollamaModels,
  lmstudio: lmstudioModels,
  silicon: siliconModels,
  ppio: ppioModels,
  alayanew: alayanewModels,
  openai: openaiModels,
  'azure-openai': azure_openaiModels,
  gemini: geminiModels,
  anthropic: anthropicModels,
  deepseek: deepseekModels,
  together: togetherModels,
  ocoolai: ocoolaiModels,
  github: githubModels,
  copilot: copilotModels,
  yi: yiModels,
  zhipu: zhipuModels,
  moonshot: moonshotModels,
  baichuan: baichuanModels,
  modelscope: modelscopeModels,
  dashscope: dashscopeModels,
  stepfun: stepfunModels,
  doubao: doubaoModels,
  minimax: minimaxModels,
  'minimax-global': minimax_globalModels,
  hyperbolic: hyperbolicModels,
  grok: grokModels,
  mistral: mistralModels,
  jina: jinaModels,
  fireworks: fireworksModels,
  hunyuan: hunyuanModels,
  nvidia: nvidiaModels,
  openrouter: openrouterModels,
  groq: groqModels,
  'baidu-cloud': baidu_cloudModels,
  dmxapi: dmxapiModels,
  perplexity: perplexityModels,
  infini: infiniModels,
  xirang: xirangModels,
  'tencent-cloud-ti': tencent_cloud_tiModels,
  gpustack: gpustackModels,
  voyageai: voyageaiModels,
  qiniu: qiniuModels,
  tokenflux: tokenfluxModels,
  cephalon: cephalonModels,
  lanyun: lanyunModels,
  'new-api': new_apiModels,
  'aws-bedrock': aws_bedrockModels,
  poe: poeModels,
  aionly: aionlyModels,
  longcat: longcatModels,
  huggingface: huggingfaceModels,
  gateway: gatewayModels,
  cerebras: cerebrasModels,
  mimo: mimoModels,
  zai: zaiModels
}
