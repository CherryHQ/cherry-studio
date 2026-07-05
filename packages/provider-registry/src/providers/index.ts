import p_302ai from './302ai'
import p_aihubmix from './aihubmix'
import p_aionly from './aionly'
import p_alayanew from './alayanew'
import p_anthropic from './anthropic'
import p_aws_bedrock from './aws-bedrock'
import p_azure_openai from './azure-openai'
import p_baichuan from './baichuan'
import p_baidu_cloud from './baidu-cloud'
import p_burncloud from './burncloud'
import p_cerebras from './cerebras'
import p_cherryin from './cherryin'
import p_claude_code from './claude-code'
import p_copilot from './copilot'
import p_dashscope from './dashscope'
import p_deepseek from './deepseek'
import p_dmxapi from './dmxapi'
import p_doubao from './doubao'
import p_fireworks from './fireworks'
import p_gateway from './gateway'
import p_gemini from './gemini'
import p_github from './github'
import p_gpustack from './gpustack'
import p_grok from './grok'
import p_grok_cli from './grok-cli'
import p_groq from './groq'
import p_huggingface from './huggingface'
import p_hunyuan from './hunyuan'
import p_hyperbolic from './hyperbolic'
import p_infini from './infini'
import p_jina from './jina'
import p_lanyun from './lanyun'
import p_lmstudio from './lmstudio'
import p_longcat from './longcat'
import p_mimo from './mimo'
import p_minimax from './minimax'
import p_minimax_global from './minimax-global'
import p_mistral from './mistral'
import p_modelscope from './modelscope'
import p_moonshot from './moonshot'
import p_new_api from './new-api'
import p_nvidia from './nvidia'
import p_ocoolai from './ocoolai'
import p_ollama from './ollama'
import p_openai from './openai'
import p_openai_codex from './openai-codex'
import p_opencode from './opencode'
import p_openrouter from './openrouter'
import p_ovms from './ovms'
import p_perplexity from './perplexity'
import p_ph8 from './ph8'
import p_poe from './poe'
import p_ppio from './ppio'
import p_qiniu from './qiniu'
import p_silicon from './silicon'
import p_sophnet from './sophnet'
import p_stepfun from './stepfun'
import p_tencent_cloud_ti from './tencent-cloud-ti'
import p_together from './together'
import p_tokenhub from './tokenhub'
import type { Provider } from './types'
import p_vertexai from './vertexai'
import p_voyageai from './voyageai'
import p_xirang from './xirang'
import p_yi from './yi'
import p_zai from './zai'
import p_zhipu from './zhipu'

/** Every provider, in registry order. Source of truth for data/providers.json + data/provider-models.json. */
export const PROVIDERS: Provider[] = [
  p_cherryin,
  p_silicon,
  p_aihubmix,
  p_ovms,
  p_ocoolai,
  p_zhipu,
  p_deepseek,
  p_alayanew,
  p_dmxapi,
  p_aionly,
  p_burncloud,
  p_302ai,
  p_lanyun,
  p_ph8,
  p_sophnet,
  p_ppio,
  p_qiniu,
  p_openrouter,
  p_ollama,
  p_new_api,
  p_lmstudio,
  p_anthropic,
  p_claude_code,
  p_openai_codex,
  p_grok_cli,
  p_openai,
  p_opencode,
  p_azure_openai,
  p_gemini,
  p_vertexai,
  p_github,
  p_copilot,
  p_yi,
  p_moonshot,
  p_baichuan,
  p_dashscope,
  p_stepfun,
  p_doubao,
  p_infini,
  p_minimax,
  p_groq,
  p_together,
  p_fireworks,
  p_nvidia,
  p_grok,
  p_hyperbolic,
  p_mistral,
  p_jina,
  p_perplexity,
  p_modelscope,
  p_xirang,
  p_hunyuan,
  p_tencent_cloud_ti,
  p_tokenhub,
  p_baidu_cloud,
  p_gpustack,
  p_voyageai,
  p_aws_bedrock,
  p_poe,
  p_longcat,
  p_huggingface,
  p_gateway,
  p_cerebras,
  p_mimo,
  p_zai,
  p_minimax_global
]
