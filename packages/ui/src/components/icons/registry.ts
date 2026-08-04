import { MODEL_ICON_META_CATALOG, type ModelIconKey } from './models/meta-catalog'
import { PROVIDER_ICON_META_CATALOG, type ProviderIconKey } from './providers/meta-catalog'
import type { IconMeta } from './types'

// NOTE: the vendor-level regex below duplicate `@cherrystudio/provider-registry`'s
// `VENDOR_PATTERNS` (anthropic, gemini, gemma, grok, doubao, hunyuan, kimi, zhipu,
// mimo, ling, qwen). Kept in sync manually until UI's build surface lets us
// import from `@cherrystudio/provider-registry` directly. When adding / tweaking
// a vendor pattern, update BOTH places — or, better, fix the UI → registry import
// story and swap these inline regex for `VENDOR_PATTERNS.<vendor>`.

/**
 * Model ID regex patterns mapped to MODEL_ICON_CATALOG keys.
 * Order matters: more specific patterns must come before general ones.
 */
const MODEL_ICON_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // GPT 5.6 series (most specific first; APIs use both `5.6` and `5-6`)
  [/gpt-5[.-]6-luna/i, 'gpt-5-6-luna'],
  [/gpt-5[.-]6-sol/i, 'gpt-5-6-sol'],
  [/gpt-5[.-]6-terra/i, 'gpt-5-6-terra'],
  // GPT 5.5 series
  [/gpt-5[.-]5-pro/i, 'gpt-5-5-pro'],
  [/gpt-5[.-]5/i, 'gpt-5-5'],
  // GPT 5.4 series
  [/gpt-5[.-]4-mini/i, 'gpt-5-4-mini'],
  [/gpt-5[.-]4-nano/i, 'gpt-5-4-nano'],
  [/gpt-5[.-]4-pro/i, 'gpt-5-4-pro'],
  [/gpt-5[.-]4/i, 'gpt-5-4'],
  // GPT 5.3 series
  [/gpt-5[.-]3-codex/i, 'gpt-5-3-codex'],
  [/gpt-5[.-]3-chat/i, 'gpt-5-3-chat-latest'],
  // GPT 5.2 series
  [/gpt-5[.-]2-chat/i, 'gpt-5-2-chat-latest'],
  [/gpt-5[.-]2-codex/i, 'gpt-5-2-codex'],
  [/gpt-5[.-]2-pro/i, 'gpt-5-2-pro'],
  [/gpt-5[.-]2/i, 'gpt-5-2'],
  // GPT 5.1 series
  [/gpt-5[.-]1-codex-max/i, 'gpt-5-1-codex-max'],
  [/gpt-5[.-]1-codex-mini/i, 'gpt-5-1-codex-mini'],
  [/gpt-5[.-]1-codex/i, 'gpt-5-1-codex'],
  [/gpt-5[.-]1-chat-latest/i, 'gpt-5-1-chat-latest'],
  [/gpt-5[.-]1-chat/i, 'gpt-5-1-chat'],
  [/gpt-5[.-]1/i, 'gpt-5-1'],
  // GPT 5 series
  [/gpt-5-mini/i, 'gpt-5-mini'],
  [/gpt-5-nano/i, 'gpt-5-nano'],
  [/gpt-5-pro/i, 'gpt-5-pro'],
  [/gpt-5-chat/i, 'gpt-5-chat'],
  [/gpt-5-codex/i, 'gpt-5-codex'],
  [/gpt-5/i, 'gpt-5'],
  // GPT 4o series
  [/gpt-4o-mini-audio-preview/i, 'gpt-4o-mini-audio-preview'],
  [/gpt-4o-mini-realtime-preview/i, 'gpt-4o-mini-realtime-preview'],
  [/gpt-4o-mini-search-preview/i, 'gpt-4o-mini-search-preview'],
  [/gpt-4o-mini-transcribe/i, 'gpt-4o-mini-transcribe'],
  [/gpt-4o-mini-tts/i, 'gpt-4o-mini-tts'],
  [/gpt-4o-mini/i, 'gpt-4o-mini'],
  [/gpt-4o-audio-preview/i, 'gpt-4o-audio-preview'],
  [/gpt-4o-realtime-preview/i, 'gpt-4o-realtime-preview'],
  [/gpt-4o-search-preview/i, 'gpt-4o-search-preview'],
  [/gpt-4o-transcribe-diarize/i, 'gpt-4o-transcribe-diarize'],
  [/gpt-4o-transcribe/i, 'gpt-4o-transcribe'],
  [/gpt-4o/i, 'gpt-4o'],
  // GPT 4 and 3.5 series
  [/gpt-4[.-]1-mini/i, 'gpt-4-1-mini'],
  [/gpt-4[.-]1-nano/i, 'gpt-4-1-nano'],
  [/gpt-4[.-]1/i, 'gpt-4-1'],
  [/gpt-4[.-]5-preview/i, 'gpt-4-5-preview'],
  [/gpt-4-turbo-preview/i, 'gpt-4-turbo-preview'],
  [/gpt-4-turbo/i, 'gpt-4-turbo'],
  [/gpt-4(?:-|$)/i, 'gpt-4'],
  [/gpt-3[.-]5-turbo/i, 'gpt-3-5-turbo'],
  // GPT OSS
  [/gpt-oss-120b/i, 'gpt-oss-120b'],
  [/gpt-oss-20b/i, 'gpt-oss-20b'],
  // GPT image
  [/gpt-image-2/i, 'gpt-image-2'],
  [/gpt-image-1-mini/i, 'gpt-image-1-mini'],
  [/gpt-image-1[.-]5/i, 'gpt-image-1-5'],
  [/gpt-image/i, 'gpt-image-1'],
  // GPT audio and realtime
  [/gpt-audio-1[.-]5/i, 'gpt-audio-1-5'],
  [/gpt-audio-mini/i, 'gpt-audio-mini'],
  [/gpt-audio/i, 'gpt-audio'],
  [/gpt-realtime-2[.-]1-mini/i, 'gpt-realtime-2-1-mini'],
  [/gpt-realtime-2[.-]1/i, 'gpt-realtime-2-1'],
  [/gpt-realtime-2/i, 'gpt-realtime-2'],
  [/gpt-realtime-1[.-]5/i, 'gpt-realtime-1-5'],
  [/gpt-realtime-mini/i, 'gpt-realtime-mini'],
  [/gpt-realtime-translate/i, 'gpt-realtime-translate'],
  [/gpt-realtime-whisper/i, 'gpt-realtime-whisper'],
  [/gpt-realtime/i, 'gpt-realtime'],
  [/(?:^|[-_/])(?:dall-e|dalle)(?:[-_/.\d]|$)/i, 'dalle'],
  // Sora (bare `sora`, `sora-2`, `sora_x`, `sora2` — but not e.g. `pandora`)
  [/(?:^|[-_/])sora(?:[-_\d]|$)/i, 'sora'],
  // Claude / Anthropic models
  [/(claude|anthropic-)/i, 'claude'],
  // Google models (nano-banana = Gemini 2.5 Flash Image; lyria = music gen)
  [/nano-?banana/i, 'nanobanana'],
  [/gemini|veo|imagen|lyria/i, 'gemini'],
  [/gemma/i, 'gemma'],
  // Widely used model families with dedicated model marks
  [/deepseek/i, 'deepseek'],
  [/nous-|hermes|deephermes/i, 'nousresearch'],
  [/llama|meta-/i, 'meta'],
  [/mistral|pixtral|codestral|ministral|voxtral|devstral|mixtral|magistral/i, 'mistral'],
  [/minimax|abab/i, 'minimax'],
  [/jamba|j2-/i, 'ai21'],
  [/aya/i, 'aya'],
  [/command-r|command-a|c4ai-|cohere|north-/i, 'cohere'],
  [/nemotron|nvidia/i, 'nvidia'],
  [/voyage/i, 'voyage'],
  [/solar/i, 'upstage'],
  [/bge/i, 'baai'],
  [/cogito/i, 'deepcogito'],
  [/mercury/i, 'inception'],
  [/relace/i, 'relace'],
  [/jina/i, 'jina'],
  [/(?:^|[-_/])(?:pplx|sonar)(?:[-_/]|$)/i, 'perplexity'],
  [/(?:^|[-_/])flux(?:[-_.\d]|$)/i, 'flux'],
  [/ideogram/i, 'ideogram'],
  [/stable-|sd3|sdxl/i, 'stability'],
  [/(?:^|[-_/])kling(?:[-_/]|$)/i, 'kling'],
  [/(?:^|[-_/])kolors(?:[-_/]|$)/i, 'kolors'],
  [/(?:^|[-_/])suno(?:[-_/]|$)/i, 'suno'],
  [/(?:^|[-_/])longcat(?:[-_/]|$)/i, 'longcat'],
  // Chinese models
  // `wan` is delimiter-bounded so `taiwan-llm` doesn't misfire to the Qwen icon
  [/qwen|qwq|qvq|(?:^|[-_/])wan(?:[-_\d]|$)|z-image/i, 'qwen'],
  [/chatglm/i, 'chatglm'],
  [/cogview|cogvideo/i, 'cogview'],
  [/glm[-_.\d]*v(?:[-_/.\d]|$)/i, 'glmv'],
  [/glm/i, 'glm'],
  [/baichuan/i, 'baichuan'],
  [/internlm|internvl/i, 'internlm'],
  [/(?:^|[-_/])yi(?:[-_/]|$)/i, 'yi'],
  [/ernie|wenxin/i, 'wenxin'],
  [/(?:^|[-_/])step(?:[-_/]|$)/i, 'stepfun'],
  // `seed` delimiter-bounded (mirrors VENDOR_PATTERNS.doubao) so `bytedance-seed`'s bare
  // `seed-2.0-lite`/`seed-1.6` match, while `seedream`/`seedance` keep their explicit alts
  [/doubao|seedream|seedance|ep-202|(?:^|[-_/])seed(?:[-_\d]|$)/i, 'doubao'],
  [/^(?:hunyuan|hy-|hy\d)/i, 'hunyuan'],
  [/kimi|moonshot/i, 'kimi'],
  // Other model-specific icons
  [/grok/i, 'grok'],
  [/hailuo/i, 'hailuo'],
  [/happy-?horse/i, 'happyhorse'],
  [/codegeex/i, 'codegeex'],
  [/mimo/i, 'mimo'],
  [/palm|bison/i, 'palm'],
  [/ibm/i, 'ibm'],
  [/trinity/i, 'trinity'],
  // sensenova before nova: `sensenova-*` must not be preempted by the broader `nova`
  [/sensenova/i, 'sensenova'],
  [/nova/i, 'nova'],
  // delimiter-bounded so `spring-1t`, `ringo-v1`, `*-multilingual-*` don't misfire to the Ling icon
  [/(?:^|[-_/])(?:ling|ring)(?:[-_]|$)/i, 'ling']
]

/**
 * Model ID regex → PROVIDER_ICON_CATALOG key.
 * Used when a model has no dedicated model icon but its name implies a provider.
 * E.g. "deepseek-chat" → deepseek provider icon, "llama-3.1-70b" → meta provider icon.
 */
const MODEL_TO_PROVIDER_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // OpenAI (incl. embedding, TTS, etc.)
  [
    /\bgpt\b|(?:^|[-_/])o[134](?:[-_]|$)|chatgpt|dall-e|whisper|tts-|text-embedding-ada|text-embedding-3|babbage|davinci/i,
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
  [/command-r|command-a|c4ai-|cohere|embed-|rerank-|north-/i, 'cohere'],
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
  [/yi-/i, 'zero-one'],
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
  [/arcee|spotlight|virtuoso|coder-large/i, 'arcee-ai'],
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
  [/dolphin/i, 'dolphin-ai'],
  // ElevenLabs
  [/eleven/i, 'elevenlabs'],
  // Relace
  [/relace/i, 'relace'],
  // Riverflow
  [/riverflow/i, 'riverflow'],
  // Kling / Kolors (both Kuaishou image/video)
  [/kling|kolors/i, 'kling'],
  // Jimeng (ByteDance/Volcengine image/video)
  [/jimeng/i, 'jimeng'],
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
  [/bce/i, 'netease-youdao'],
  // BAAI / BGE
  [/bge/i, 'baai'],
  // Deep Cogito
  [/cogito/i, 'deepcogito'],
  // Ideogram
  [/ideogram/i, 'ideogram'],
  // Recraft
  [/recraft/i, 'recraft'],
  // Runway
  [/runway/i, 'runway'],
  // Stability AI
  [/stable-|sd3|sdxl/i, 'stability'],
  // TNG
  [/tng-/i, 'tng']
]

/**
 * Provider ID aliases for IDs that don't directly match catalog keys.
 */
const PROVIDER_ID_ALIASES: Record<string, string> = {
  // Codex is an OpenAI product; reuse the OpenAI mark until a dedicated glyph exists.
  'openai-codex': 'openai',
  // Grok CLI is an xAI product; reuse the Grok mark.
  'grok-cli': 'grok',
  'azure-openai': 'azureai',
  'new-api': 'newapi',
  'tencent-cloud-ti': 'tencent-cloud-ti',
  tokenhub: 'tencent-cloud-ti',
  'baidu-cloud': 'baidu-cloud',
  'aws-bedrock': 'aws-bedrock',
  'gitee-ai': 'gitee-ai',
  yi: 'zero-one',
  ovms: 'intel',
  gemini: 'google',
  copilot: 'github-copilot',
  'github-copilot-openai-compatible': 'github-copilot',
  doubao: 'volcengine',
  stepfun: 'step',
  voyageai: 'voyage',
  gateway: 'vercel',
  zhinao: 'xirang',
  aionly: 'ai-only',
  dashscope: 'bailian',
  zai: 'z-ai',
  'minimax-global': 'minimax',
  cherryai: 'cherryin'
}

/**
 * Synchronous handle for an icon: which catalog it lives in, its key, and its
 * meta. Resolving a ref touches only the (light) meta catalogs — the actual
 * component loads asynchronously via `loadIcon` / `useIcon`.
 */
export type IconRef =
  | { kind: 'provider'; key: ProviderIconKey; meta: IconMeta }
  | { kind: 'model'; key: ModelIconKey; meta: IconMeta }

function providerRef(key: string): IconRef | undefined {
  const meta = (PROVIDER_ICON_META_CATALOG as Record<string, IconMeta>)[key]
  return meta ? { kind: 'provider', key: key as ProviderIconKey, meta } : undefined
}

function modelRef(key: string): IconRef | undefined {
  const meta = (MODEL_ICON_META_CATALOG as Record<string, IconMeta>)[key]
  return meta ? { kind: 'model', key: key as ModelIconKey, meta } : undefined
}

/** Exact-key ref constructor — no alias or pattern logic; keys are compile-time checked. */
export function providerIconRef(key: ProviderIconKey): IconRef {
  return { kind: 'provider', key, meta: PROVIDER_ICON_META_CATALOG[key] }
}

/** Exact-key ref constructor — no alias or pattern logic; keys are compile-time checked. */
export function modelIconRef(key: ModelIconKey): IconRef {
  return { kind: 'model', key, meta: MODEL_ICON_META_CATALOG[key] }
}

/** Resolve a dedicated model icon ref by matching modelId against MODEL_ICON_PATTERNS */
export function resolveModelIconRef(modelId: string): IconRef | undefined {
  if (!modelId) return undefined
  for (const [regex, catalogKey] of MODEL_ICON_PATTERNS) {
    if (regex.test(modelId)) {
      return modelRef(catalogKey)
    }
  }
  return undefined
}

/** Resolve a provider icon ref by matching modelId against MODEL_TO_PROVIDER_PATTERNS */
export function resolveModelToProviderIconRef(modelId: string): IconRef | undefined {
  if (!modelId) return undefined
  for (const [regex, catalogKey] of MODEL_TO_PROVIDER_PATTERNS) {
    if (regex.test(modelId)) {
      return providerRef(catalogKey)
    }
  }
  return undefined
}

/** Resolve a provider icon ref by provider ID (with alias support, model icon fallback) */
export function resolveProviderIconRef(providerId: string): IconRef | undefined {
  if (!providerId) return undefined
  const key = PROVIDER_ID_ALIASES[providerId] ?? providerId
  return providerRef(key) ?? modelRef(key)
}

/**
 * Resolve an icon ref with full fallback chain:
 *  1. Model-specific icon (MODEL_ICON_PATTERNS regex on modelId)
 *  2. Provider icon inferred from modelId (MODEL_TO_PROVIDER_PATTERNS regex)
 *  3. Provider icon by providerId (exact match + aliases)
 */
export function resolveIconRef(modelId: string, providerId: string): IconRef | undefined {
  return resolveModelIconRef(modelId) ?? resolveModelToProviderIconRef(modelId) ?? resolveProviderIconRef(providerId)
}
