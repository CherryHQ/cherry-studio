/**
 * Reasoning / thinking-mode model checks and reasoning-effort configuration.
 *
 * Pure family/variant checks delegate to `@shared/utils/model`. Renderer-only
 * concerns (`ThinkingOptionConfig` mapping, `getThinkModelType`) stay here.
 * v2 `Model.capabilities` is authoritative (registry inference + baked-in
 * user overrides merged by `ModelService`).
 */
import type {
  ReasoningEffortConfig,
  ReasoningEffortOption,
  ThinkingModelType,
  ThinkingOptionConfig
} from '@renderer/types'
import { getLowerBaseModelName } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'
import {
  DOUBAO_THINKING_AUTO_MODEL_REGEX as SHARED_DOUBAO_THINKING_AUTO_MODEL_REGEX,
  DOUBAO_THINKING_MODEL_REGEX as SHARED_DOUBAO_THINKING_MODEL_REGEX,
  findTokenLimit as sharedFindTokenLimit,
  GEMINI_THINKING_MODEL_REGEX as SHARED_GEMINI_THINKING_MODEL_REGEX,
  isBaichuanReasoningModel as sharedIsBaichuanReasoningModel,
  isClaude4SeriesModel as sharedIsClaude4SeriesModel,
  isClaude45ReasoningModel as sharedIsClaude45ReasoningModel,
  isClaudeReasoningModel as sharedIsClaudeReasoningModel,
  isDeepSeekHybridInferenceModel as sharedIsDeepSeekHybridInferenceModel,
  isDeepSeekV4PlusModel as sharedIsDeepSeekV4PlusModel,
  isDoubaoSeed18Model as sharedIsDoubaoSeed18Model,
  isDoubaoSeedAfter251015 as sharedIsDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel as sharedIsDoubaoThinkingAutoModel,
  isGeminiReasoningModel as sharedIsGeminiReasoningModel,
  isGrok4FastReasoningModel as sharedIsGrok4FastReasoningModel,
  isGrokReasoningModel as sharedIsGrokReasoningModel,
  isHostedGemma4ThinkingModel as sharedIsHostedGemma4ThinkingModel,
  isHunyuanReasoningModel as sharedIsHunyuanReasoningModel,
  isKimiReasoningModel as sharedIsKimiReasoningModel,
  isLingReasoningModel as sharedIsLingReasoningModel,
  isMiMoReasoningModel as sharedIsMiMoReasoningModel,
  isMiniMaxReasoningModel as sharedIsMiniMaxReasoningModel,
  isMistralReasoningModel as sharedIsMistralReasoningModel,
  isPerplexityReasoningModel as sharedIsPerplexityReasoningModel,
  isQwenAlwaysThinkModel as sharedIsQwenAlwaysThinkModel,
  isQwenReasoningModel as sharedIsQwenReasoningModel,
  isReasoningModel as sharedIsReasoningModel,
  isStepReasoningModel as sharedIsStepReasoningModel,
  isSupportedReasoningEffortGrokModel as sharedIsSupportedReasoningEffortGrokModel,
  isSupportedReasoningEffortPerplexityModel as sharedIsSupportedReasoningEffortPerplexityModel,
  isSupportedThinkingTokenDeepSeekModel as sharedIsSupportedThinkingTokenDeepSeekModel,
  isSupportedThinkingTokenDoubaoModel as sharedIsSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenGeminiModel as sharedIsSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenHunyuanModel as sharedIsSupportedThinkingTokenHunyuanModel,
  isSupportedThinkingTokenKimiModel as sharedIsSupportedThinkingTokenKimiModel,
  isSupportedThinkingTokenMiMoModel as sharedIsSupportedThinkingTokenMiMoModel,
  isSupportedThinkingTokenQwenModel as sharedIsSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel as sharedIsSupportedThinkingTokenZhipuModel,
  isZhipuReasoningModel as sharedIsZhipuReasoningModel,
  REASONING_REGEX as SHARED_REASONING_REGEX
} from '@shared/utils/model'

import {
  isGPT5FamilyModel,
  isGPT5ProModel,
  isGPT5SeriesModel,
  isGPT51CodexMaxModel,
  isGPT51SeriesModel,
  isGPT52SeriesModel,
  isOpenAIDeepResearchModel,
  isOpenAIOpenWeightModel,
  isSupportedReasoningEffortOpenAIModel
} from './openai'
import {
  GEMINI_FLASH_MODEL_REGEX,
  getRawModelId,
  isClaude46SeriesModel,
  isClaude47SeriesModel,
  isGemini3FlashModel,
  isGemini3ProModel,
  isGemini31FlashLiteModel,
  isGemini31ProModel,
  withModelIdAndNameAsId
} from './utils'

// ── Re-exports (public API preserved) ─────────────────────────────────────
export const REASONING_REGEX = SHARED_REASONING_REGEX
export const GEMINI_THINKING_MODEL_REGEX = SHARED_GEMINI_THINKING_MODEL_REGEX
export const DOUBAO_THINKING_MODEL_REGEX = SHARED_DOUBAO_THINKING_MODEL_REGEX
export const DOUBAO_THINKING_AUTO_MODEL_REGEX = SHARED_DOUBAO_THINKING_AUTO_MODEL_REGEX

// ── Renderer-only UI config: effort / option maps ─────────────────────────
// TODO: refactor this. too many identical options
export const MODEL_SUPPORTED_REASONING_EFFORT = {
  default: ['low', 'medium', 'high'] as const,
  o: ['low', 'medium', 'high'] as const,
  openai_deep_research: ['medium'] as const,
  gpt5: ['minimal', 'low', 'medium', 'high'] as const,
  gpt5_codex: ['low', 'medium', 'high'] as const,
  gpt5_1: ['none', 'low', 'medium', 'high'] as const,
  gpt5_1_codex: ['medium', 'high'] as const,
  gpt5_1_codex_max: ['medium', 'high', 'xhigh'] as const,
  gpt5_2_codex: ['low', 'medium', 'high', 'xhigh'] as const,
  gpt5_2: ['none', 'low', 'medium', 'high', 'xhigh'] as const,
  gpt5pro: ['high'] as const,
  gpt52pro: ['medium', 'high', 'xhigh'] as const,
  gpt_oss: ['low', 'medium', 'high'] as const,
  grok: ['low', 'high'] as const,
  grok4_fast: ['auto'] as const,
  gemini2_flash: ['low', 'medium', 'high', 'auto'] as const,
  gemini2_pro: ['low', 'medium', 'high', 'auto'] as const,
  gemini3_flash: ['minimal', 'low', 'medium', 'high'] as const,
  gemini3_pro: ['low', 'high'] as const,
  gemini3_1_pro: ['low', 'medium', 'high'] as const,
  // Google-hosted Gemma 4 documents `minimal` as the closest supported near-off
  // setting for most requests, but does not guarantee thinking is fully disabled.
  // Keep the formal UI options aligned with the API guarantee and omit `none`.
  gemma4_hosted: ['minimal', 'high'] as const,
  qwen: ['low', 'medium', 'high'] as const,
  qwen_thinking: ['low', 'medium', 'high'] as const,
  doubao: ['auto', 'high'] as const,
  doubao_no_auto: ['high'] as const,
  doubao_after_251015: ['minimal', 'low', 'medium', 'high'] as const,
  hunyuan: ['auto'] as const,
  mimo: ['auto'] as const,
  zhipu: ['auto'] as const,
  perplexity: ['low', 'medium', 'high'] as const,
  deepseek_hybrid: ['auto'] as const,
  deepseek_v4: ['high', 'xhigh'] as const,
  kimi_k2_5: ['none', 'auto'] as const,
  claude: ['low', 'medium', 'high'] as const,
  claude46: ['low', 'medium', 'high', 'xhigh'] as const,
  mistral: ['high'] as const
} as const satisfies ReasoningEffortConfig

export const MODEL_SUPPORTED_OPTIONS: ThinkingOptionConfig = {
  default: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.default] as const,
  o: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.o] as const,
  openai_deep_research: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.openai_deep_research] as const,
  gpt5: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5] as const,
  gpt5pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5pro] as const,
  gpt5_codex: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_codex] as const,
  gpt5_1: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_1] as const,
  gpt5_1_codex: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_1_codex] as const,
  gpt5_2_codex: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_2_codex] as const,
  gpt5_2: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_2] as const,
  gpt5_1_codex_max: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt5_1_codex_max] as const,
  gpt52pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt52pro] as const,
  gpt_oss: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gpt_oss] as const,
  grok: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.grok] as const,
  grok4_fast: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.grok4_fast] as const,
  gemini2_flash: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini2_flash] as const,
  gemini2_pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini2_pro] as const,
  gemini3_flash: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini3_flash] as const,
  gemini3_pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini3_pro] as const,
  gemini3_1_pro: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemini3_1_pro] as const,
  gemma4_hosted: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.gemma4_hosted] as const,
  qwen: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.qwen] as const,
  qwen_thinking: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.qwen_thinking] as const,
  doubao: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao] as const,
  doubao_no_auto: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao_no_auto] as const,
  doubao_after_251015: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.doubao_after_251015] as const,
  mimo: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.mimo] as const,
  hunyuan: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.hunyuan] as const,
  zhipu: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.zhipu] as const,
  perplexity: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.perplexity] as const,
  deepseek_hybrid: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.deepseek_hybrid] as const,
  deepseek_v4: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.deepseek_v4] as const,
  kimi_k2_5: ['default', ...MODEL_SUPPORTED_REASONING_EFFORT.kimi_k2_5] as const,
  claude: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.claude] as const,
  claude46: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.claude46] as const,
  mistral: ['default', 'none', ...MODEL_SUPPORTED_REASONING_EFFORT.mistral] as const
} as const

// ── Pure family / variant checks (delegated to shared) ───────────────────

export const isClaude45ReasoningModel = (model: Model): boolean => sharedIsClaude45ReasoningModel(model)

export const isClaude4SeriesModel = (model: Model): boolean => sharedIsClaude4SeriesModel(model)

export const isClaudeReasoningModel = (model?: Model): boolean => (model ? sharedIsClaudeReasoningModel(model) : false)

export const isSupportedThinkingTokenClaudeModel = isClaudeReasoningModel

export const isGeminiReasoningModel = (model?: Model): boolean => (model ? sharedIsGeminiReasoningModel(model) : false)

export const isSupportedThinkingTokenGeminiModel = (model: Model): boolean =>
  sharedIsSupportedThinkingTokenGeminiModel(model)

export const isQwenReasoningModel = (model?: Model): boolean => (model ? sharedIsQwenReasoningModel(model) : false)

export const isSupportedThinkingTokenQwenModel = (model?: Model): boolean =>
  model ? sharedIsSupportedThinkingTokenQwenModel(model) : false

export const isQwenAlwaysThinkModel = (model?: Model): boolean => (model ? sharedIsQwenAlwaysThinkModel(model) : false)

export const isSupportedThinkingTokenDoubaoModel = (model?: Model): boolean =>
  model ? sharedIsSupportedThinkingTokenDoubaoModel(model) : false

export const isDoubaoThinkingAutoModel = (model: Model): boolean => sharedIsDoubaoThinkingAutoModel(model)

export const isDoubaoSeedAfter251015 = (model: Model): boolean => sharedIsDoubaoSeedAfter251015(model)

export const isDoubaoSeed18Model = (model: Model): boolean => sharedIsDoubaoSeed18Model(model)

export const isGrokReasoningModel = (model?: Model): boolean => (model ? sharedIsGrokReasoningModel(model) : false)

export const isSupportedReasoningEffortGrokModel = (model?: Model): boolean =>
  model ? sharedIsSupportedReasoningEffortGrokModel(model) : false

export const isGrok4FastReasoningModel = (model?: Model): boolean =>
  model ? sharedIsGrok4FastReasoningModel(model) : false

export const isHostedGemma4ThinkingModel = (model?: Model): boolean =>
  model ? sharedIsHostedGemma4ThinkingModel(model) : false

export const isHunyuanReasoningModel = (model?: Model): boolean =>
  model ? sharedIsHunyuanReasoningModel(model) : false

export const isSupportedThinkingTokenHunyuanModel = (model?: Model): boolean =>
  model ? sharedIsSupportedThinkingTokenHunyuanModel(model) : false

export const isPerplexityReasoningModel = (model?: Model): boolean =>
  model ? sharedIsPerplexityReasoningModel(model) : false

export const isSupportedReasoningEffortPerplexityModel = (model: Model): boolean =>
  sharedIsSupportedReasoningEffortPerplexityModel(model)

export const isSupportedThinkingTokenZhipuModel = (model: Model): boolean =>
  sharedIsSupportedThinkingTokenZhipuModel(model)

export const isZhipuReasoningModel = (model?: Model): boolean => (model ? sharedIsZhipuReasoningModel(model) : false)

export const isSupportedThinkingTokenMiMoModel = (model: Model): boolean =>
  sharedIsSupportedThinkingTokenMiMoModel(model)

export const isMiMoReasoningModel = (model?: Model): boolean => (model ? sharedIsMiMoReasoningModel(model) : false)

export const isSupportedThinkingTokenKimiModel = (model: Model): boolean =>
  sharedIsSupportedThinkingTokenKimiModel(model)

export const isKimiReasoningModel = (model?: Model): boolean => (model ? sharedIsKimiReasoningModel(model) : false)

export const isDeepSeekHybridInferenceModel = (model: Model): boolean => sharedIsDeepSeekHybridInferenceModel(model)

export const isDeepSeekV4PlusModel = (model: Model): boolean => sharedIsDeepSeekV4PlusModel(model)

export const isSupportedThinkingTokenDeepSeekModel = (model: Model): boolean =>
  sharedIsSupportedThinkingTokenDeepSeekModel(model)

export const isLingReasoningModel = (model?: Model): boolean => (model ? sharedIsLingReasoningModel(model) : false)

export const isStepReasoningModel = (model?: Model): boolean => (model ? sharedIsStepReasoningModel(model) : false)

export const isMiniMaxReasoningModel = (model?: Model): boolean =>
  model ? sharedIsMiniMaxReasoningModel(model) : false

export const isBaichuanReasoningModel = (model?: Model): boolean =>
  model ? sharedIsBaichuanReasoningModel(model) : false

export const isMistralReasoningModel = (model?: Model): boolean =>
  model ? sharedIsMistralReasoningModel(model) : false

/**
 * Composes renderer-local checks so the result reflects regex-based inference
 * rather than shared's `reasoning != null` schema check.
 */
export const isFixedReasoningModel = (model: Model): boolean =>
  isReasoningModel(model) && !isSupportedThinkingTokenModel(model) && !isSupportedReasoningEffortModel(model)

const INTERLEAVED_THINKING_MODEL_REGEX =
  /minimax-m2(.(\d+))?(?:-[\w-]+)?|mimo-v2-flash|glm-5(?:.\d+)?(?:-[\w-]+)?|glm-4.(\d+)(?:-[\w-]+)?|kimi-k2-thinking?|kimi-k2.5$/i

/** @deprecated Kept for legacy callers. Pure-ID inference. */
export const isInterleavedThinkingModel = (model: Model): boolean =>
  INTERLEAVED_THINKING_MODEL_REGEX.test(getLowerBaseModelName(getRawModelId(model)))

export const findTokenLimit = sharedFindTokenLimit

// ── Aggregate checks (renderer keeps these because they compose multiple above) ─

function _isSupportedThinkingTokenModel(model: Model): boolean {
  return (
    isSupportedThinkingTokenGeminiModel(model) ||
    isSupportedThinkingTokenQwenModel(model) ||
    isSupportedThinkingTokenClaudeModel(model) ||
    isSupportedThinkingTokenDoubaoModel(model) ||
    isSupportedThinkingTokenHunyuanModel(model) ||
    isSupportedThinkingTokenZhipuModel(model) ||
    isSupportedThinkingTokenMiMoModel(model) ||
    isSupportedThinkingTokenKimiModel(model) ||
    isSupportedThinkingTokenDeepSeekModel(model)
  )
}

/** 用于判断是否支持控制思考，但不一定以 reasoning_effort 的方式 */
export function isSupportedThinkingTokenModel(model?: Model): boolean {
  if (!model) return false
  const { idResult, nameResult } = withModelIdAndNameAsId(model, _isSupportedThinkingTokenModel)
  return idResult || nameResult
}

export function isSupportedReasoningEffortModel(model?: Model): boolean {
  if (!model) return false
  return (
    isSupportedReasoningEffortOpenAIModel(model) ||
    isSupportedReasoningEffortGrokModel(model) ||
    isSupportedReasoningEffortPerplexityModel(model)
  )
}

// ── Renderer-only: ThinkingModelType dispatch ─────────────────────────────

const _getThinkModelType = (model: Model): ThinkingModelType => {
  let thinkingModelType: ThinkingModelType = 'default'
  const modelId = getLowerBaseModelName(getRawModelId(model))
  if (isClaudeReasoningModel(model)) {
    thinkingModelType = 'claude'
    // 4.7 reuses the 4.6 effort list (low/medium/high/xhigh); provider-level
    // mapping still distinguishes them (4.7 sends native 'xhigh', 4.6 sends 'max').
    if (isClaude46SeriesModel(model) || isClaude47SeriesModel(model)) {
      thinkingModelType = 'claude46'
    }
  } else if (isOpenAIDeepResearchModel(model)) {
    return 'openai_deep_research'
  } else if (isGPT5FamilyModel(model)) {
    if (isGPT51SeriesModel(model)) {
      if (modelId.includes('codex')) {
        thinkingModelType = 'gpt5_1_codex'
        if (isGPT51CodexMaxModel(model)) thinkingModelType = 'gpt5_1_codex_max'
      } else {
        thinkingModelType = 'gpt5_1'
      }
    } else if (isGPT52SeriesModel(model) && modelId.includes('codex')) {
      thinkingModelType = 'gpt5_2_codex'
    } else if (isGPT5SeriesModel(model)) {
      if (modelId.includes('codex')) {
        thinkingModelType = 'gpt5_codex'
      } else {
        thinkingModelType = 'gpt5'
        if (isGPT5ProModel(model)) thinkingModelType = 'gpt5pro'
      }
    } else {
      if (modelId.includes('-pro')) thinkingModelType = 'gpt52pro'
      else thinkingModelType = 'gpt5_2'
    }
  } else if (isOpenAIOpenWeightModel(model)) {
    thinkingModelType = 'gpt_oss'
  } else if (isSupportedReasoningEffortOpenAIModel(model)) {
    thinkingModelType = 'o'
  } else if (isGrok4FastReasoningModel(model)) {
    thinkingModelType = 'grok4_fast'
  } else if (isSupportedThinkingTokenGeminiModel(model)) {
    if (isHostedGemma4ThinkingModel(model)) {
      thinkingModelType = 'gemma4_hosted'
    } else if (isGemini3FlashModel(model) || isGemini31FlashLiteModel(model)) {
      thinkingModelType = 'gemini3_flash'
    } else if (isGemini3ProModel(model)) {
      thinkingModelType = 'gemini3_pro'
    } else if (isGemini31ProModel(model)) {
      thinkingModelType = 'gemini3_1_pro'
    } else if (GEMINI_FLASH_MODEL_REGEX.test(getRawModelId(model))) {
      thinkingModelType = 'gemini2_flash'
    } else {
      thinkingModelType = 'gemini2_pro'
    }
  } else if (isSupportedReasoningEffortGrokModel(model)) {
    thinkingModelType = 'grok'
  } else if (isSupportedThinkingTokenQwenModel(model)) {
    if (isQwenAlwaysThinkModel(model)) thinkingModelType = 'qwen_thinking'
    thinkingModelType = 'qwen'
  } else if (isSupportedThinkingTokenDoubaoModel(model)) {
    if (isDoubaoThinkingAutoModel(model)) thinkingModelType = 'doubao'
    else if (isDoubaoSeedAfter251015(model) || isDoubaoSeed18Model(model)) thinkingModelType = 'doubao_after_251015'
    else thinkingModelType = 'doubao_no_auto'
  } else if (isSupportedThinkingTokenHunyuanModel(model)) {
    thinkingModelType = 'hunyuan'
  } else if (isSupportedReasoningEffortPerplexityModel(model)) {
    thinkingModelType = 'perplexity'
  } else if (isSupportedThinkingTokenZhipuModel(model)) {
    thinkingModelType = 'zhipu'
  } else if (isDeepSeekV4PlusModel(model)) {
    thinkingModelType = 'deepseek_v4'
  } else if (isDeepSeekHybridInferenceModel(model)) {
    thinkingModelType = 'deepseek_hybrid'
  } else if (isSupportedThinkingTokenMiMoModel(model)) {
    thinkingModelType = 'mimo'
  } else if (isSupportedThinkingTokenKimiModel(model)) {
    thinkingModelType = 'kimi_k2_5'
  } else if (isMistralReasoningModel(model)) {
    thinkingModelType = 'mistral'
  }
  return thinkingModelType
}

export const getThinkModelType = (model: Model): ThinkingModelType => {
  const { idResult, nameResult } = withModelIdAndNameAsId(model, _getThinkModelType)
  return idResult !== 'default' ? idResult : nameResult
}

const _getModelSupportedReasoningEffortOptions = (model: Model): ReasoningEffortOption[] | undefined => {
  if (!isSupportedReasoningEffortModel(model) && !isSupportedThinkingTokenModel(model)) return undefined
  const thinkingType = _getThinkModelType(model)
  return MODEL_SUPPORTED_OPTIONS[thinkingType]
}

export const getModelSupportedReasoningEffortOptions = (
  model: Model | undefined | null
): ReasoningEffortOption[] | undefined => {
  if (!model) return undefined
  const { idResult, nameResult } = withModelIdAndNameAsId(model, _getModelSupportedReasoningEffortOptions)
  return idResult ?? nameResult
}

/**
 * Reasoning-model check. Reads shared's `REASONING` capability. v2
 * `Model.capabilities` is authoritative (registry inference + baked-in user
 * overrides merged by `ModelService`).
 */
export function isReasoningModel(model?: Model): boolean {
  if (!model) return false
  return sharedIsReasoningModel(model)
}
