import { MODEL_ICON_CATALOG, type ModelIconKey } from './models/catalog'
import { PROVIDER_ICON_CATALOG, type ProviderIconKey } from './providers/catalog'
import type { CompoundIcon } from './types'

/**
 * Model ID regex patterns mapped to MODEL_ICON_CATALOG keys.
 * Order matters: more specific patterns must come before general ones.
 */
const MODEL_ICON_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // GPT 5.1 series (most specific first)
  [/gpt-5\.1-codex-mini/i, 'gpt51CodexMini'],
  [/gpt-5\.1-codex/i, 'gpt51Codex'],
  [/gpt-5\.1-chat/i, 'gpt51Chat'],
  [/gpt-5\.1/i, 'gpt51'],
  // GPT 5.2 series
  [/gpt-5\.2-pro/i, 'gpt52Pro'],
  [/gpt-5\.2/i, 'gpt52'],
  // GPT 5 series
  [/gpt-5-mini/i, 'gpt5Mini'],
  [/gpt-5-nano/i, 'gpt5Nano'],
  [/gpt-5-chat/i, 'gpt5Chat'],
  [/gpt-5-codex/i, 'gpt5Codex'],
  [/gpt-5/i, 'gpt5'],
  // GPT OSS
  [/gpt-oss-120b/i, 'gptOss120b'],
  [/gpt-oss-20b/i, 'gptOss20b'],
  // GPT image
  [/gpt-image-1\.5/i, 'gptImage15'],
  [/gpt-image/i, 'gptImage1'],
  // Sora
  [/(sora-|sora_)/i, 'sora'],
  // Claude / Anthropic models
  [/(claude|anthropic-)/i, 'claude'],
  // Google models
  [/gemini|veo|imagen/i, 'gemini'],
  [/gemma/i, 'gemma'],
  // Chinese models
  [/(qwen|qwq|qvq|wan-)/i, 'qwen'],
  [/glm/i, 'glm'],
  [/doubao|seedream|seedance|ep-202/i, 'doubao'],
  [/hunyuan/i, 'hunyuan'],
  [/kimi|moonshot/i, 'kimi'],
  // Other model-specific icons
  [/grok/i, 'grok'],
  [/hailuo/i, 'hailuo'],
  [/codegeex/i, 'codegeex'],
  [/mimo/i, 'mimo'],
  [/palm|bison/i, 'palm'],
  [/ibm/i, 'ibm'],
  [/aya/i, 'aya'],
  [/trinity/i, 'trinity'],
  [/nova/i, 'nova'],
  [/ling|ring/i, 'ling'],
  [/sensenova/i, 'sensenova']
]

/**
 * Model ID regex → PROVIDER_ICON_CATALOG key.
 * Used when a model has no dedicated model icon but its name implies a provider.
 * E.g. "deepseek-chat" → deepseek provider icon, "llama-3.1-70b" → meta provider icon.
 */
const MODEL_TO_PROVIDER_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // OpenAI (incl. embedding, TTS, etc.)
  [
    /gpt-5|gpt-4|gpt-3|o1-|o3-|o4-|chatgpt|dall-e|whisper|tts-|text-embedding-ada|text-embedding-3|babbage|davinci/i,
    'openai'
  ],
  // Google (incl. embedding models)
  [/palm|veo|imagen|learnlm|text-embedding-00|text-multilingual-embedding-00/i, 'google'],
  // Meta / Llama
  [/llama|meta-/i, 'meta'],
  // DeepSeek
  [/deepseek/i, 'deepseek'],
  // Mistral (incl. voxtral, devstral, mixtral, magistral)
  [/mistral|pixtral|codestral|ministral|voxtral|devstral|mixtral|magistral/i, 'mistral'],
  // Cohere (incl. embed-*, rerank-*)
  [/command-r|command-a|c4ai-|cohere|embed-|rerank-/i, 'cohere'],
  // Nvidia
  [/nemotron|nvidia/i, 'nvidia'],
  // Microsoft / Phi
  [/phi-|orca|wizardlm|microsoft/i, 'azureai'],
  // Inflection
  [/inflection/i, 'inflection'],
  // Nous Research
  [/nous-|hermes|deephermes/i, 'nousresearch'],
  // Databricks
  [/dbrx/i, 'databricks'],
  // Allen AI
  [/olmo|molmo|tulu/i, 'allenai'],
  // Perplexity
  [/pplx-|sonar/i, 'perplexity'],
  // Moonshot / Kimi
  [/moonshot/i, 'moonshot'],
  // Zhipu (incl. cogview, cogvideo)
  [/chatglm|cogview|cogvideo/i, 'zhipu'],
  // Minimax
  [/minimax|abab/i, 'minimax'],
  // Baichuan
  [/baichuan/i, 'baichuan'],
  // Step
  [/step-/i, 'step'],
  // 01.AI / Yi
  [/yi-/i, 'zeroOne'],
  // Cerebras
  [/cerebras/i, 'cerebras'],
  // Hugging Face
  [/huggingface/i, 'huggingface'],
  // Liquid
  [/lfm-/i, 'liquid'],
  // AI21
  [/jamba|j2-/i, 'ai21'],
  // Upstage
  [/solar/i, 'upstage'],
  // Arcee AI (incl. trinity, spotlight, virtuoso, coder-large)
  [/arcee|spotlight|virtuoso|coder-large/i, 'arceeAi'],
  // InternLM
  [/internlm|internvl|intern/i, 'internlm'],
  // Wenxin / Ernie (Baidu)
  [/ernie|wenxin/i, 'wenxin'],
  // Volcengine / Bytedance (incl. ui-tars, seed)
  [/skylark|ui-tars/i, 'volcengine'],
  // Voyage
  [/voyage/i, 'voyage'],
  // Nomic
  [/nomic/i, 'nomic'],
  // Mixedbread
  [/mxbai/i, 'mixedbread'],
  // Jina
  [/jina/i, 'jina'],
  // BFL / Flux
  [/flux/i, 'bfl'],
  // StreamLake
  [/kat/i, 'streamlake'],
  // Dolphin AI
  [/dolphin/i, 'dolphinAi'],
  // ElevenLabs
  [/eleven/i, 'elevenlabs'],
  // Relace
  [/relace/i, 'relace'],
  // Riverflow
  [/riverflow/i, 'riverflow'],
  // Kling
  [/kling/i, 'kling'],
  // Suno
  [/suno/i, 'suno'],
  // Infini / Megrez
  [/megrez/i, 'infini'],
  // Aionlabs
  [/aion/i, 'aionlabs'],
  // Inception / Mercury
  [/mercury/i, 'inceptionlabs'],
  // Longcat / Meituan
  [/longcat/i, 'longcat'],
  // Kwaipilot
  [/kwaipilot/i, 'kwaipilot'],
  // Netease Youdao / BCE
  [/bce/i, 'neteaseYoudao'],
  // BAAI / BGE
  [/bge/i, 'baai'],
  // Deep Cogito
  [/cogito/i, 'deepcogito'],
  // Ideogram
  [/ideogram/i, 'ideogram'],
  // Recraft
  [/recraft/i, 'recraft'],
  // Runway
  [/runway/i, 'runaway'],
  // Stability AI
  [/stable-|sd3|sdxl/i, 'stablility'],
  // TNG
  [/tng-/i, 'tng']
]

/**
 * Provider ID aliases for IDs that don't directly match catalog keys.
 */
const PROVIDER_ID_ALIASES: Record<string, string> = {
  'azure-openai': 'azureai',
  'new-api': 'newapi',
  'tencent-cloud-ti': 'tencentCloudTi',
  'baidu-cloud': 'baiduCloud',
  'aws-bedrock': 'awsBedrock',
  'gitee-ai': 'giteeAi',
  yi: 'zeroOne',
  ovms: 'intel',
  gemini: 'google',
  copilot: 'github',
  doubao: 'volcengine',
  stepfun: 'step',
  voyageai: 'voyage',
  gateway: 'vercel',
  zhinao: 'xirang',
  aionly: 'aiOnly'
}

/** Resolve a dedicated model icon by matching modelId against MODEL_ICON_PATTERNS */
export function resolveModelIcon(modelId: string): CompoundIcon | undefined {
  if (!modelId) return undefined
  for (const [regex, catalogKey] of MODEL_ICON_PATTERNS) {
    if (regex.test(modelId)) {
      return MODEL_ICON_CATALOG[catalogKey as ModelIconKey]
    }
  }
  return undefined
}

/** Resolve a provider icon by matching modelId against MODEL_TO_PROVIDER_PATTERNS */
export function resolveModelToProviderIcon(modelId: string): CompoundIcon | undefined {
  if (!modelId) return undefined
  for (const [regex, catalogKey] of MODEL_TO_PROVIDER_PATTERNS) {
    if (regex.test(modelId)) {
      return PROVIDER_ICON_CATALOG[catalogKey as ProviderIconKey]
    }
  }
  return undefined
}

/** Resolve a provider icon by provider ID (with alias support, model icon fallback) */
export function resolveProviderIcon(providerId: string): CompoundIcon | undefined {
  if (!providerId) return undefined
  const key = PROVIDER_ID_ALIASES[providerId] ?? providerId
  return (
    (PROVIDER_ICON_CATALOG as Record<string, CompoundIcon>)[key] ??
    (MODEL_ICON_CATALOG as Record<string, CompoundIcon>)[key]
  )
}

/**
 * Resolve icon with full fallback chain:
 *  1. Model-specific icon (MODEL_ICON_PATTERNS regex on modelId)
 *  2. Provider icon inferred from modelId (MODEL_TO_PROVIDER_PATTERNS regex)
 *  3. Provider icon by providerId (exact match + aliases)
 */
export function resolveIcon(modelId: string, providerId: string): CompoundIcon | undefined {
  return resolveModelIcon(modelId) ?? resolveModelToProviderIcon(modelId) ?? resolveProviderIcon(providerId)
}
