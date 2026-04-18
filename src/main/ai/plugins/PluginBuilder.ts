import type { AiPlugin } from '@cherrystudio/ai-core'

/**
 * Build the plugin array for createAgent().
 *
 * Phase 1: returns empty array. The following existing plugin files under
 * `src/main/ai/plugins/` are not yet wired into the v2 stream path and are
 * therefore inactive:
 *
 *   - reasoningExtractionPlugin   (extract <think> tags as reasoning blocks)
 *   - noThinkPlugin               (send /no_think for models that use it)
 *   - qwenThinkingPlugin          (Qwen3 enable_thinking flag)
 *   - openrouterReasoningPlugin   (OpenRouter reasoning.* parameters)
 *   - reasoningTimePlugin         (accumulate thinking_millsec into metadata)
 *   - skipGeminiThoughtSignaturePlugin (strip Gemini thoughtSignature field)
 *   - simulateStreamingPlugin     (wrap non-streaming providers as streaming)
 *
 * TODO(v2-plugin-migration): decide whether each plugin is superseded by a
 * `@cherrystudio/ai-core` built-in middleware (e.g. reasoningExtraction may
 * be redundant with ai-core's reasoning middleware) or still needs to be
 * appended here conditionally per provider/model. Until then, reasoning-
 * extraction and provider-quirk patches are user-visibly inactive.
 */
export function buildPlugins(): AiPlugin[] {
  return []
}
