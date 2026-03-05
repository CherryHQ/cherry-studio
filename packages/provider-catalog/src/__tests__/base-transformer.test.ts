import { describe, expect, it } from 'vitest'

import {
  CAPABILITY_PATTERNS,
  expandKnownPrefixes,
  extractParameterSize,
  normalizeModelId,
  normalizeVersionSeparators,
  stripParameterSize,
  stripVariantSuffixes
} from '../utils/importers/base/base-transformer'

describe('normalizeVersionSeparators', () => {
  it('should normalize comma separator between digits to hyphen', () => {
    expect(normalizeVersionSeparators('gpt-3,5-turbo')).toBe('gpt-3-5-turbo')
    expect(normalizeVersionSeparators('claude-3,5-sonnet')).toBe('claude-3-5-sonnet')
  })

  it('should normalize dot separator between digits to hyphen', () => {
    // Dots are now converted to hyphens for version patterns
    expect(normalizeVersionSeparators('gpt-3.5-turbo')).toBe('gpt-3-5-turbo')
    expect(normalizeVersionSeparators('claude-3.5-sonnet')).toBe('claude-3-5-sonnet')
    expect(normalizeVersionSeparators('claude-sonnet-4.5')).toBe('claude-sonnet-4-5')
  })

  it('should NOT normalize existing hyphen separators (keeps hyphen as-is)', () => {
    // Hyphens are left unchanged to avoid date pattern confusion
    expect(normalizeVersionSeparators('gpt-3-5-turbo')).toBe('gpt-3-5-turbo')
    expect(normalizeVersionSeparators('claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
    expect(normalizeVersionSeparators('qwen-2-5-72b')).toBe('qwen-2-5-72b')
    expect(normalizeVersionSeparators('llama-3-1-70b')).toBe('llama-3-1-70b')
  })

  it('should normalize p separator between digits to hyphen', () => {
    expect(normalizeVersionSeparators('gpt-3p5-turbo')).toBe('gpt-3-5-turbo')
    expect(normalizeVersionSeparators('claude-3p5-sonnet')).toBe('claude-3-5-sonnet')
  })

  it('should not change model IDs without version patterns', () => {
    expect(normalizeVersionSeparators('llama-70b')).toBe('llama-70b')
    expect(normalizeVersionSeparators('gpt-4')).toBe('gpt-4')
    expect(normalizeVersionSeparators('claude-sonnet')).toBe('claude-sonnet')
  })

  it('should normalize dots in version patterns', () => {
    // Dots between digits are now converted to hyphens
    expect(normalizeVersionSeparators('claude-3.5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022')
  })

  it('should not normalize date-like patterns (YYYYMMDD)', () => {
    // Date patterns should remain unchanged
    expect(normalizeVersionSeparators('model-20241022')).toBe('model-20241022')
  })

  it('should not normalize date suffix patterns (r1-0728)', () => {
    // r1-0728 should stay as r1-0728 because hyphens are not touched
    expect(normalizeVersionSeparators('deepseek-r1-0728')).toBe('deepseek-r1-0728')
    expect(normalizeVersionSeparators('model-v1-0520')).toBe('model-v1-0520')
  })

  it('should handle overlapping multi-dot versions (e.g., 4.0.1)', () => {
    expect(normalizeVersionSeparators('exaone-4.0.1')).toBe('exaone-4-0-1')
    expect(normalizeVersionSeparators('model-1.2.3')).toBe('model-1-2-3')
    expect(normalizeVersionSeparators('v0.1.2')).toBe('v0-1-2')
    expect(normalizeVersionSeparators('gpt-4.5.1')).toBe('gpt-4-5-1')
  })

  it('should handle edge cases', () => {
    expect(normalizeVersionSeparators('')).toBe('')
    expect(normalizeVersionSeparators('simple-model')).toBe('simple-model')
    expect(normalizeVersionSeparators('model-v1')).toBe('model-v1')
  })
})

describe('extractParameterSize', () => {
  it('should extract integer parameter sizes', () => {
    expect(extractParameterSize('qwen-2.5-72b')).toBe('72b')
    expect(extractParameterSize('llama-3.1-70b')).toBe('70b')
    expect(extractParameterSize('phi-4-7b')).toBe('7b')
    expect(extractParameterSize('mistral-8b')).toBe('8b')
  })

  it('should extract decimal parameter sizes', () => {
    expect(extractParameterSize('qwen-2.5-1.5b')).toBe('1.5b')
    expect(extractParameterSize('llama-3.2-3.5b')).toBe('3.5b')
    expect(extractParameterSize('gemma-2-2.5b')).toBe('2.5b')
  })

  it('should handle parameter sizes with instruct/chat suffixes', () => {
    expect(extractParameterSize('qwen-2.5-72b-instruct')).toBe('72b')
    expect(extractParameterSize('llama-3.1-8b-chat')).toBe('8b')
    expect(extractParameterSize('mistral-7b-instruct-v0.2')).toBe('7b')
  })

  it('should return undefined for models without parameter size', () => {
    expect(extractParameterSize('gpt-4o')).toBeUndefined()
    expect(extractParameterSize('claude-3.5-sonnet')).toBeUndefined()
    expect(extractParameterSize('gemini-1.5-pro')).toBeUndefined()
  })

  it('should not match version numbers that look like parameter sizes', () => {
    // Version numbers should NOT be extracted as parameter sizes
    expect(extractParameterSize('gpt-4')).toBeUndefined()
    expect(extractParameterSize('claude-3')).toBeUndefined()
  })
})

describe('stripParameterSize', () => {
  it('should strip parameter size suffix', () => {
    expect(stripParameterSize('qwen-2.5-72b')).toBe('qwen-2.5')
    expect(stripParameterSize('llama-3.1-70b')).toBe('llama-3.1')
    expect(stripParameterSize('qwen-2.5-1.5b')).toBe('qwen-2.5')
  })

  it('should strip parameter size but keep other suffixes', () => {
    expect(stripParameterSize('qwen-2.5-72b-instruct')).toBe('qwen-2.5-instruct')
    expect(stripParameterSize('llama-3.1-8b-chat')).toBe('llama-3.1-chat')
  })

  it('should not change models without parameter size', () => {
    expect(stripParameterSize('gpt-4o')).toBe('gpt-4o')
    expect(stripParameterSize('claude-3.5-sonnet')).toBe('claude-3.5-sonnet')
  })
})

describe('stripVariantSuffixes', () => {
  it('should strip -tee variant suffix', () => {
    expect(stripVariantSuffixes('deepseek-r1-0728-tee')).toBe('deepseek-r1-0728')
    expect(stripVariantSuffixes('model-tee')).toBe('model')
  })

  it('should strip other common variant suffixes', () => {
    expect(stripVariantSuffixes('model:free')).toBe('model')
    expect(stripVariantSuffixes('model-free')).toBe('model')
    expect(stripVariantSuffixes('model-thinking')).toBe('model')
  })
})

describe('normalizeModelId (full flow)', () => {
  it('should normalize version separators after stripping prefixes and suffixes', () => {
    // Test the full normalization pipeline
    expect(normalizeModelId('anthropic/claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
    expect(normalizeModelId('openai/gpt-3,5-turbo')).toBe('gpt-3-5-turbo')
  })

  it('should strip parameter size suffix', () => {
    // Parameter size should be stripped, leaving base model family
    expect(normalizeModelId('meta/llama-3-1-70b')).toBe('llama-3-1')
    expect(normalizeModelId('qwen/qwen-2-5-72b')).toBe('qwen-2-5')
    expect(normalizeModelId('qwen/qwen-2-5-7b')).toBe('qwen-2-5')
    expect(normalizeModelId('qwen/qwen-2-5-1.5b')).toBe('qwen-2-5')
  })

  it('should strip parameter size but keep other suffixes', () => {
    // -instruct, -chat etc. should remain after parameter size is stripped
    expect(normalizeModelId('qwen/qwen-2-5-72b-instruct')).toBe('qwen-2-5-instruct')
    expect(normalizeModelId('meta/llama-3-1-8b-chat')).toBe('llama-3-1-chat')
  })

  it('should preserve api_model_id by keeping original before normalization', () => {
    // The original ID should be stored in api_model_id/original_id
    // This test verifies the normalized ID is different from original
    const originalId = 'anthropic/claude-3-5-sonnet:free'
    const normalizedId = normalizeModelId(originalId)

    expect(normalizedId).toBe('claude-3-5-sonnet')
    expect(normalizedId).not.toBe(originalId) // api_model_id should store originalId
  })

  it('should handle complex model IDs with prefixes, versions, variants, and parameter sizes', () => {
    // AIHubMix style: prefix + version variant
    expect(normalizeModelId('aihubmix-claude-3-5-sonnet')).toBe('claude-3-5-sonnet')

    // OpenRouter style: provider/model:variant
    expect(normalizeModelId('deepseek/deepseek-r1:free')).toBe('deepseek-r1')

    // Full pipeline: prefix + version + param size + suffix + variant
    expect(normalizeModelId('openrouter/qwen/qwen-2-5-72b-instruct:free')).toBe('qwen-2-5-instruct')
  })

  it('should handle date suffixes correctly (not convert to dot)', () => {
    // Date-like suffixes should not be converted
    expect(normalizeModelId('deepseek/deepseek-r1-0728')).toBe('deepseek-r1-0728')
    expect(normalizeModelId('deepseek/deepseek-r1-0728-tee')).toBe('deepseek-r1-0728')
  })

  it('should strip provider prefix with org/ path (302ai bug fix)', () => {
    // 302ai models use org prefixes like "zai-org/glm-4.5"
    // Previously produced "org/glm-4-5" due to missing split('/')
    expect(normalizeModelId('zai-org/glm-4.5')).toBe('glm-4-5')
    expect(normalizeModelId('sf/zai-org/glm-4.5')).toBe('glm-4-5')
    expect(normalizeModelId('pro/zai-org/glm-4.5')).toBe('glm-4-5')
  })

  it('should handle multi-segment paths (aggregator/org/model)', () => {
    // Only the last segment after final '/' is used
    expect(normalizeModelId('openrouter/anthropic/claude-3.5-sonnet')).toBe('claude-3-5-sonnet')
    expect(normalizeModelId('a/b/c/model-v1')).toBe('model-v1')
  })

  it('should strip parenthesized variant suffixes', () => {
    expect(normalizeModelId('gpt-4o (free)')).toBe('gpt-4o')
    expect(normalizeModelId('gpt-4o(free)')).toBe('gpt-4o')
    expect(normalizeModelId('model (beta)')).toBe('model')
    expect(normalizeModelId('model (preview)')).toBe('model')
    expect(normalizeModelId('model (thinking)')).toBe('model')
  })

  it('should preserve compound words with protected prefixes (non-, no-, etc.)', () => {
    // "non-reasoning" is part of model name, not a variant suffix
    expect(normalizeModelId('grok-4-1-fast-non-reasoning')).toBe('grok-4-1-fast-non-reasoning')
    expect(normalizeModelId('model-non-thinking')).toBe('model-non-thinking')
    // But standalone "-reasoning" should still be stripped
    expect(normalizeModelId('deepseek-r1-reasoning')).toBe('deepseek-r1')
    expect(normalizeModelId('model-thinking')).toBe('model')
  })

  it('should expand mm- to minimax- after aggregator prefix stripping', () => {
    // DMXAPI-MM-M2.1: strip dmxapi-, then expand remaining mm- to minimax-
    expect(normalizeModelId('DMXAPI-MM-M2.1')).toBe('minimax-m2-1')
    expect(normalizeModelId('DMXAPI-MM-M2')).toBe('minimax-m2')
  })

  it('should strip mm- as aggregator routing prefix when it leads', () => {
    // mm-minimax-m2.1: mm- is aihubmix routing prefix, stripped → minimax-m2.1
    expect(normalizeModelId('mm-minimax-m2.1')).toBe('minimax-m2-1')
    expect(normalizeModelId('mm-minimax-m2')).toBe('minimax-m2')
  })

  it('should normalize overlapping multi-dot versions in full flow', () => {
    expect(normalizeModelId('LGAI-EXAONE/EXAONE-4.0.1-32B')).toBe('exaone-4-0-1')
  })

  it('should handle models without any prefix or suffix', () => {
    expect(normalizeModelId('gpt-4o')).toBe('gpt-4o')
    expect(normalizeModelId('claude-sonnet-4')).toBe('claude-sonnet-4')
  })
})

describe('expandKnownPrefixes', () => {
  it('should expand mm- to minimax-', () => {
    expect(expandKnownPrefixes('mm-m2-1')).toBe('minimax-m2-1')
    expect(expandKnownPrefixes('mm-m2')).toBe('minimax-m2')
    expect(expandKnownPrefixes('mm-m1')).toBe('minimax-m1')
  })

  it('should not expand non-matching prefixes', () => {
    expect(expandKnownPrefixes('minimax-m2')).toBe('minimax-m2')
    expect(expandKnownPrefixes('gpt-4o')).toBe('gpt-4o')
    expect(expandKnownPrefixes('claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
  })

  it('should not expand mm in the middle of a name', () => {
    expect(expandKnownPrefixes('model-mm-v1')).toBe('model-mm-v1')
  })
})

/**
 * Helper: check which capabilities a model ID matches
 */
function inferCapabilities(modelId: string): string[] {
  const caps: string[] = []
  for (const [match, exclude, capability] of CAPABILITY_PATTERNS) {
    if (match.test(modelId) && (!exclude || !exclude.test(modelId))) {
      caps.push(capability)
    }
  }
  return caps
}

describe('CAPABILITY_PATTERNS — REASONING detection', () => {
  it('should detect REASONING for o-series models', () => {
    expect(inferCapabilities('o1')).toContain('reasoning')
    expect(inferCapabilities('o3')).toContain('reasoning')
    expect(inferCapabilities('o3-mini')).toContain('reasoning')
    expect(inferCapabilities('o4-mini')).toContain('reasoning')
  })

  it('should detect REASONING for keyword-based models', () => {
    expect(inferCapabilities('deepseek-r1')).toContain('reasoning')
    expect(inferCapabilities('deepseek-r1-0728')).toContain('reasoning')
    expect(inferCapabilities('qwq-32b')).toContain('reasoning')
    expect(inferCapabilities('qvq-72b')).toContain('reasoning')
    expect(inferCapabilities('model-reasoning')).toContain('reasoning')
    expect(inferCapabilities('model-thinking')).toContain('reasoning')
  })

  it('should detect REASONING for specific vendor models', () => {
    expect(inferCapabilities('claude-sonnet-4')).toContain('reasoning')
    expect(inferCapabilities('claude-opus-4')).toContain('reasoning')
    expect(inferCapabilities('claude-3-7-sonnet')).toContain('reasoning')
    expect(inferCapabilities('grok-4')).toContain('reasoning')
    expect(inferCapabilities('grok-3-mini')).toContain('reasoning')
    expect(inferCapabilities('gemini-2-5-flash')).toContain('reasoning')
    expect(inferCapabilities('gemini-2-5-pro')).toContain('reasoning')
    expect(inferCapabilities('deepseek-v3')).toContain('reasoning')
    expect(inferCapabilities('deepseek-chat')).toContain('reasoning')
    expect(inferCapabilities('hunyuan-t1')).toContain('reasoning')
    expect(inferCapabilities('glm-zero-preview')).toContain('reasoning')
    expect(inferCapabilities('magistral-medium')).toContain('reasoning')
    expect(inferCapabilities('mimo-v2')).toContain('reasoning')
    expect(inferCapabilities('sonar-deep-research')).toContain('reasoning')
  })

  it('should NOT detect REASONING for non-reasoning models', () => {
    expect(inferCapabilities('gpt-4o')).not.toContain('reasoning')
    expect(inferCapabilities('claude-3-5-sonnet')).not.toContain('reasoning')
    expect(inferCapabilities('llama-3-1-70b')).not.toContain('reasoning')
    expect(inferCapabilities('gemini-2-0-flash')).not.toContain('reasoning')
    expect(inferCapabilities('claude-3-haiku')).not.toContain('reasoning')
  })

  it('should NOT detect REASONING for non-reasoning keyword in name', () => {
    expect(inferCapabilities('model-non-reasoning')).not.toContain('reasoning')
  })

  it('should NOT detect REASONING for embedding/rerank/generation models', () => {
    expect(inferCapabilities('reasoning-embed-v1')).not.toContain('reasoning')
    expect(inferCapabilities('thinking-rerank')).not.toContain('reasoning')
  })
})

describe('CAPABILITY_PATTERNS — FUNCTION_CALL detection', () => {
  it('should detect FUNCTION_CALL for OpenAI models', () => {
    expect(inferCapabilities('gpt-4o')).toContain('function_call')
    expect(inferCapabilities('gpt-4-turbo')).toContain('function_call')
    expect(inferCapabilities('gpt-4.1')).toContain('function_call')
    expect(inferCapabilities('gpt-4.5-preview')).toContain('function_call')
    expect(inferCapabilities('gpt-5')).toContain('function_call')
    expect(inferCapabilities('o3')).toContain('function_call')
    expect(inferCapabilities('o4-mini')).toContain('function_call')
  })

  it('should detect FUNCTION_CALL for Anthropic Claude models', () => {
    expect(inferCapabilities('claude-3-5-sonnet')).toContain('function_call')
    expect(inferCapabilities('claude-sonnet-4')).toContain('function_call')
    expect(inferCapabilities('claude-opus-4')).toContain('function_call')
  })

  it('should detect FUNCTION_CALL for Google Gemini models', () => {
    expect(inferCapabilities('gemini-2-0-flash')).toContain('function_call')
    expect(inferCapabilities('gemini-2-5-pro')).toContain('function_call')
    expect(inferCapabilities('gemini-3-flash')).toContain('function_call')
  })

  it('should detect FUNCTION_CALL for other vendor models', () => {
    expect(inferCapabilities('deepseek-chat')).toContain('function_call')
    expect(inferCapabilities('qwen-2-5-72b')).toContain('function_call')
    expect(inferCapabilities('grok-3')).toContain('function_call')
    expect(inferCapabilities('llama-4-scout')).toContain('function_call')
    expect(inferCapabilities('mistral-large')).toContain('function_call')
    expect(inferCapabilities('kimi-k2')).toContain('function_call')
  })

  it('should NOT detect FUNCTION_CALL for excluded models', () => {
    expect(inferCapabilities('o1-mini')).not.toContain('function_call')
    expect(inferCapabilities('o1-preview')).not.toContain('function_call')
    expect(inferCapabilities('text-embedding-3-large')).not.toContain('function_call')
    expect(inferCapabilities('dall-e-3')).not.toContain('function_call')
    expect(inferCapabilities('whisper-1')).not.toContain('function_call')
  })

  it('should NOT detect FUNCTION_CALL for non-tool-use models', () => {
    expect(inferCapabilities('llama-3-1-70b')).not.toContain('function_call')
    expect(inferCapabilities('phi-4')).not.toContain('function_call')
    expect(inferCapabilities('stable-diffusion-xl')).not.toContain('function_call')
  })
})

describe('CAPABILITY_PATTERNS — IMAGE_RECOGNITION detection (enhanced)', () => {
  it('should detect IMAGE_RECOGNITION for OpenAI multimodal models', () => {
    expect(inferCapabilities('gpt-4o')).toContain('image_recognition')
    expect(inferCapabilities('gpt-4-turbo')).toContain('image_recognition')
    expect(inferCapabilities('gpt-4.1')).toContain('image_recognition')
    expect(inferCapabilities('gpt-5')).toContain('image_recognition')
    expect(inferCapabilities('o3')).toContain('image_recognition')
  })

  it('should detect IMAGE_RECOGNITION for Anthropic Claude 3+ models', () => {
    expect(inferCapabilities('claude-3-5-sonnet')).toContain('image_recognition')
    expect(inferCapabilities('claude-3-haiku')).toContain('image_recognition')
    expect(inferCapabilities('claude-sonnet-4')).toContain('image_recognition')
    expect(inferCapabilities('claude-opus-4')).toContain('image_recognition')
  })

  it('should detect IMAGE_RECOGNITION for Google Gemini models', () => {
    expect(inferCapabilities('gemini-1-5-pro')).toContain('image_recognition')
    expect(inferCapabilities('gemini-2-0-flash')).toContain('image_recognition')
    expect(inferCapabilities('gemini-3-flash')).toContain('image_recognition')
  })

  it('should detect IMAGE_RECOGNITION for vision-suffixed models', () => {
    expect(inferCapabilities('llama-3-2-11b-vision')).toContain('image_recognition')
    expect(inferCapabilities('qwen2-vl-72b')).toContain('image_recognition')
    expect(inferCapabilities('pixtral-large')).toContain('image_recognition')
    expect(inferCapabilities('internvl2-26b')).toContain('image_recognition')
  })

  it('should NOT detect IMAGE_RECOGNITION for excluded models', () => {
    expect(inferCapabilities('o1-mini')).not.toContain('image_recognition')
    expect(inferCapabilities('o3-mini')).not.toContain('image_recognition')
    expect(inferCapabilities('o1-preview')).not.toContain('image_recognition')
    expect(inferCapabilities('gpt-4-32k')).not.toContain('image_recognition')
    expect(inferCapabilities('text-embedding-3-large')).not.toContain('image_recognition')
  })

  it('should NOT detect IMAGE_RECOGNITION for non-vision models', () => {
    expect(inferCapabilities('llama-3-1-70b')).not.toContain('image_recognition')
    expect(inferCapabilities('phi-4')).not.toContain('image_recognition')
    expect(inferCapabilities('mistral-7b')).not.toContain('image_recognition')
  })
})

describe('CAPABILITY_PATTERNS — WEB_SEARCH detection', () => {
  it('should detect WEB_SEARCH for search-specific models', () => {
    expect(inferCapabilities('gpt-4o-search')).toContain('web_search')
    expect(inferCapabilities('sonar-pro')).toContain('web_search')
    expect(inferCapabilities('searchgpt')).toContain('web_search')
    expect(inferCapabilities('model-online')).toContain('web_search')
  })

  it('should detect WEB_SEARCH for major models with search API support', () => {
    expect(inferCapabilities('gpt-4o')).toContain('web_search')
    expect(inferCapabilities('claude-sonnet-4')).toContain('web_search')
    expect(inferCapabilities('gemini-2-0-flash')).toContain('web_search')
  })

  it('should NOT detect WEB_SEARCH for excluded models', () => {
    expect(inferCapabilities('gpt-4o-image')).not.toContain('web_search')
    expect(inferCapabilities('text-embedding-3-large')).not.toContain('web_search')
  })

  it('should NOT detect WEB_SEARCH for general models without search support', () => {
    expect(inferCapabilities('llama-3-1-70b')).not.toContain('web_search')
    expect(inferCapabilities('phi-4')).not.toContain('web_search')
    expect(inferCapabilities('mistral-7b')).not.toContain('web_search')
  })
})

describe('CAPABILITY_PATTERNS — FILE_INPUT detection (narrow regex)', () => {
  it('should detect FILE_INPUT for document-specific model names', () => {
    expect(inferCapabilities('qwen-long')).toContain('file_input')
    expect(inferCapabilities('qwen-doc')).toContain('file_input')
    expect(inferCapabilities('deepseek-ocr')).toContain('file_input')
    expect(inferCapabilities('got-ocr')).toContain('file_input')
  })

  it('should NOT detect FILE_INPUT from general model names (handled by models.dev + provider overrides)', () => {
    // These get FILE_INPUT via models.dev attachment data or provider-level overrides, not regex
    expect(inferCapabilities('claude-3-5-sonnet')).not.toContain('file_input')
    expect(inferCapabilities('gpt-4o')).not.toContain('file_input')
    expect(inferCapabilities('gemini-2-0-flash')).not.toContain('file_input')
    expect(inferCapabilities('deepseek-chat')).not.toContain('file_input')
    expect(inferCapabilities('llama-4-scout')).not.toContain('file_input')
  })
})

describe('CAPABILITY_PATTERNS — IMAGE_GENERATION should NOT imply IMAGE_RECOGNITION', () => {
  it('image generation models should not get IMAGE_RECOGNITION', () => {
    expect(inferCapabilities('dall-e-3')).toContain('image_generation')
    expect(inferCapabilities('dall-e-3')).not.toContain('image_recognition')

    expect(inferCapabilities('stable-diffusion-xl')).toContain('image_generation')
    expect(inferCapabilities('stable-diffusion-xl')).not.toContain('image_recognition')

    expect(inferCapabilities('flux-1-dev')).toContain('image_generation')
    expect(inferCapabilities('flux-1-dev')).not.toContain('image_recognition')

    expect(inferCapabilities('midjourney-v6')).toContain('image_generation')
    expect(inferCapabilities('midjourney-v6')).not.toContain('image_recognition')

    expect(inferCapabilities('ideogram-v2')).toContain('image_generation')
    expect(inferCapabilities('ideogram-v2')).not.toContain('image_recognition')
  })

  it('gpt-4o-image should get IMAGE_GENERATION but NOT IMAGE_RECOGNITION', () => {
    const caps = inferCapabilities('gpt-4o-image')
    expect(caps).toContain('image_generation')
    expect(caps).not.toContain('image_recognition')
  })

  it('video generation models should not get IMAGE_RECOGNITION', () => {
    expect(inferCapabilities('sora-v2')).not.toContain('image_recognition')
    expect(inferCapabilities('kling-v1')).not.toContain('image_recognition')
    expect(inferCapabilities('veo-2')).not.toContain('image_recognition')
  })
})

describe('CAPABILITY_PATTERNS — COMPUTER_USE detection', () => {
  it('should detect COMPUTER_USE for supported Claude models', () => {
    expect(inferCapabilities('claude-sonnet-4')).toContain('computer_use')
    expect(inferCapabilities('claude-opus-4')).toContain('computer_use')
    expect(inferCapabilities('claude-3-7-sonnet')).toContain('computer_use')
    expect(inferCapabilities('claude-3-5-sonnet-20241022')).toContain('computer_use')
    expect(inferCapabilities('claude-haiku-4')).toContain('computer_use')
  })

  it('should detect COMPUTER_USE for OpenAI CUA model', () => {
    expect(inferCapabilities('computer-use-preview')).toContain('computer_use')
  })

  it('should NOT detect COMPUTER_USE for non-supported models', () => {
    expect(inferCapabilities('gpt-4o')).not.toContain('computer_use')
    expect(inferCapabilities('gemini-2-0-flash')).not.toContain('computer_use')
    expect(inferCapabilities('deepseek-chat')).not.toContain('computer_use')
    expect(inferCapabilities('claude-3-haiku')).not.toContain('computer_use')
  })
})

describe('CAPABILITY_PATTERNS — FILE_INPUT vs IMAGE_RECOGNITION independence', () => {
  it('vision models should NOT get FILE_INPUT from regex alone', () => {
    const caps = inferCapabilities('claude-3-5-sonnet')
    expect(caps).toContain('image_recognition')
    expect(caps).not.toContain('file_input')
  })

  it('document-specific models get FILE_INPUT independently', () => {
    const caps = inferCapabilities('qwen-long')
    expect(caps).toContain('file_input')
    expect(caps).not.toContain('image_recognition')
  })
})
