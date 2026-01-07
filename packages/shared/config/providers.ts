/**
 * @fileoverview Shared provider configuration for Claude Code and Anthropic API compatibility
 *
 * This module defines which models from specific providers support the Anthropic API endpoint.
 * Used by both the Code Tools page and the Anthropic SDK client.
 */

/**
 * Silicon provider models that support Anthropic API endpoint.
 * These models can be used with Claude Code via the Anthropic-compatible API.
 *
 * @see https://docs.siliconflow.cn/cn/api-reference/chat-completions/messages
 */
export const SILICON_ANTHROPIC_COMPATIBLE_MODELS: readonly string[] = [
  // DeepSeek V3.1 series
  'Pro/deepseek-ai/DeepSeek-V3.1-Terminus',
  'deepseek-ai/DeepSeek-V3.1',
  'Pro/deepseek-ai/DeepSeek-V3.1',
  // DeepSeek V3 series
  'deepseek-ai/DeepSeek-V3',
  'Pro/deepseek-ai/DeepSeek-V3',
  // Moonshot/Kimi series
  'moonshotai/Kimi-K2-Instruct-0905',
  'Pro/moonshotai/Kimi-K2-Instruct-0905',
  'moonshotai/Kimi-Dev-72B',
  // Baidu ERNIE
  'baidu/ERNIE-4.5-300B-A47B'
]

/**
 * Creates a Set for efficient lookup of silicon Anthropic-compatible model IDs.
 */
const SILICON_ANTHROPIC_COMPATIBLE_MODEL_SET = new Set(SILICON_ANTHROPIC_COMPATIBLE_MODELS)

/**
 * Checks if a model ID is compatible with Anthropic API on Silicon provider.
 *
 * @param modelId - The model ID to check
 * @returns true if the model supports Anthropic API endpoint
 */
export function isSiliconAnthropicCompatibleModel(modelId: string): boolean {
  return SILICON_ANTHROPIC_COMPATIBLE_MODEL_SET.has(modelId)
}

/**
 * PPIO provider models that support Anthropic API endpoint.
 * These models can be used with Claude Code via the Anthropic-compatible API.
 *
 * @see https://ppio.com/docs/model/llm-anthropic-compatibility
 */
export const PPIO_ANTHROPIC_COMPATIBLE_MODELS: readonly string[] = [
  'moonshotai/kimi-k2-thinking',
  'minimax/minimax-m2',
  'deepseek/deepseek-v3.2-exp',
  'deepseek/deepseek-v3.1-terminus',
  'zai-org/glm-4.6',
  'moonshotai/kimi-k2-0905',
  'deepseek/deepseek-v3.1',
  'moonshotai/kimi-k2-instruct',
  'qwen/qwen3-next-80b-a3b-instruct',
  'qwen/qwen3-next-80b-a3b-thinking'
]

/**
 * Creates a Set for efficient lookup of PPIO Anthropic-compatible model IDs.
 */
const PPIO_ANTHROPIC_COMPATIBLE_MODEL_SET = new Set(PPIO_ANTHROPIC_COMPATIBLE_MODELS)

/**
 * Checks if a model ID is compatible with Anthropic API on PPIO provider.
 *
 * @param modelId - The model ID to check
 * @returns true if the model supports Anthropic API endpoint
 */
export function isPpioAnthropicCompatibleModel(modelId: string): boolean {
  return PPIO_ANTHROPIC_COMPATIBLE_MODEL_SET.has(modelId)
}
