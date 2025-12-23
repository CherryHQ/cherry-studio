/**
 * OpenRouter API types
 * Based on https://openrouter.ai/api/v1/models
 */

export interface OpenRouterModel {
  /** Model identifier (e.g., "anthropic/claude-3-opus") */
  id: string

  /** Canonical slug with version (e.g., "anthropic/claude-3-opus-20240229") */
  canonical_slug: string

  /** Hugging Face model ID if available */
  hugging_face_id: string | null

  /** Display name */
  name: string

  /** Unix timestamp of model creation */
  created: number

  /** Model description/documentation */
  description: string

  /** Maximum context length in tokens */
  context_length: number

  /** Architecture and modality information */
  architecture: {
    /** Modality string (e.g., "text->text", "text+image->text") */
    modality: string

    /** Input modality types */
    input_modalities: string[]

    /** Output modality types */
    output_modalities: string[]

    /** Tokenizer type */
    tokenizer: string

    /** Instruction type if applicable */
    instruct_type: string | null
  }

  /** Pricing information (per token as strings) */
  pricing: {
    /** Cost per prompt token */
    prompt: string

    /** Cost per completion token */
    completion: string

    /** Cost per request (base fee) */
    request: string

    /** Cost per image in request */
    image: string

    /** Cost for web search feature */
    web_search: string

    /** Cost for internal reasoning tokens */
    internal_reasoning: string

    /** Cost for reading cached inputs */
    input_cache_read: string
  }

  /** Top provider configuration */
  top_provider: {
    /** Context length from top provider */
    context_length: number

    /** Maximum completion tokens */
    max_completion_tokens: number | null

    /** Whether content is moderated */
    is_moderated: boolean
  }

  /** Per-request limits if any */
  per_request_limits: Record<string, any> | null

  /** Supported API parameters */
  supported_parameters: string[]

  /** Default parameter values */
  default_parameters: {
    temperature: number | null
    top_p: number | null
    frequency_penalty: number | null
  }
}

export interface OpenRouterResponse {
  /** Array of model data */
  data: OpenRouterModel[]
}
