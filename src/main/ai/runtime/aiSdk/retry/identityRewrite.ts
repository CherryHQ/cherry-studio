/**
 * Local patch (model identity): rewrites the system prompt's identity section
 * when a retry falls back to a different model.
 *
 * The primary's system prompt is built once (with the primary model's identity
 * section, see assembleSystemPrompt) and the agent loop keeps it across
 * fallbacks — ai-retry can only swap the model + call options. Without this
 * rewrite a fallback model would be told it is the primary model and
 * misreport its identity, exactly what the identity section exists to prevent.
 *
 * The wrapper is applied to the fallback model only; the identity section it
 * carries is generated for that fallback (provider + model) at fallback-build
 * time, so a fallback always reports itself truthfully.
 */
import type { LanguageModelV3, LanguageModelV3Prompt } from '@ai-sdk/provider'

/** Matches the leading identity section emitted by `buildIdentitySection`. */
const IDENTITY_SECTION_PATTERN =
  /^# Identity\n\nYou are currently running on the model "[\s\S]*?" \(provider: [\s\S]*?\)\.\nWhen asked what model or AI you are, answer truthfully with the model name above\.\nDo not claim to be a different model, company, or product\./

/** Replaces the leading identity section of `system` with `identitySection`. */
export function rewriteSystemIdentity(system: string, identitySection: string): string {
  const match = system.match(IDENTITY_SECTION_PATTERN)
  if (!match) {
    // No identity section in the primary prompt (identity injection disabled
    // at build time, or the prompt was rebuilt without it): prepend instead,
    // so the fallback still reports itself truthfully.
    return system.length === 0 ? identitySection : `${identitySection}\n\n${system}`
  }
  // The identity block is always the first section; everything after it
  // (separator + remaining sections) is preserved as-is.
  return identitySection + system.slice(match[0].length)
}

/**
 * Wraps a fallback model so every call rewrites the system message's identity
 * section to this fallback's own identity. Prompts without a string system
 * message (identity injection disabled, or a non-agent call shape) pass
 * through untouched.
 */
export function withIdentityRewrite(model: LanguageModelV3, identitySection: string): LanguageModelV3 {
  return {
    ...model,
    doGenerate: async (input) => {
      const prompt = input.prompt
      if (!prompt) return model.doGenerate(input)
      const rewritten: LanguageModelV3Prompt = prompt.map((message) =>
        message.role === 'system'
          ? { ...message, content: rewriteSystemIdentity(message.content, identitySection) }
          : message
      )
      return model.doGenerate({ ...input, prompt: rewritten })
    }
  }
}
