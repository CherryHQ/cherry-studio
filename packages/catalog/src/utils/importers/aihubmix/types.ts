/**
 * AIHubMix API response structure types
 * Based on https://aihubmix.com/api/v1/models
 */

/**
 * Single model entry from AIHubMix API
 */
export interface AiHubMixModel {
  /** Model identifier (e.g., "gpt-4", "claude-3-opus") */
  model_id: string

  /** Model description */
  desc: string

  /** Pricing information */
  pricing: {
    /** Cache read pricing (optional, e.g., Anthropic cache hits) */
    cache_read?: number
    /** Cache write pricing (optional, e.g., Anthropic cache writes) */
    cache_write?: number
    /** Input pricing per million tokens */
    input: number
    /** Output pricing per million tokens */
    output: number
  }

  /** Model type: "llm" | "image_generation" | "video" */
  types: string

  /** Comma-separated features: "thinking,tools,function_calling,web,structured_outputs" */
  features: string

  /** Comma-separated input modalities: "text,image,audio,video" */
  input_modalities: string

  /** Maximum output tokens */
  max_output: number

  /** Context window length */
  context_length: number
}

/**
 * AIHubMix API response wrapper
 */
export interface AiHubMixResponse {
  data: AiHubMixModel[]
}
