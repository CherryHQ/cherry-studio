/**
 * Google Vertex AI Anthropic Provider
 *
 * Custom provider wrapper that disables native structured output for Claude models.
 * This is necessary because Vertex AI rejects the `structured-outputs-2025-11-13` beta header
 * that @ai-sdk/anthropic adds by default for claude-opus-4-6 / claude-sonnet-4-6 /
 * claude-*-4-5 / claude-opus-4-1 models. See issue #14645.
 */
import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import {
  createVertexAnthropic,
  type GoogleVertexAnthropicProvider,
  type GoogleVertexAnthropicProviderSettings
} from '@ai-sdk/google-vertex/anthropic/edge'
import type { LanguageModelV3 } from '@ai-sdk/provider'

export function createGoogleVertexAnthropic(
  settings?: GoogleVertexAnthropicProviderSettings
): GoogleVertexAnthropicProvider {
  const baseProvider = createVertexAnthropic(settings)

  const patchedLanguageModel = (modelId: string): LanguageModelV3 => {
    const model = baseProvider.languageModel(modelId) as unknown as LanguageModelV3 & {
      config?: Record<string, unknown>
    }

    // The Vertex SDK already derives `baseURL` from `project`/`location` when
    // `settings.baseURL` is undefined and injects IAM-GCP `Authorization`
    // via `settings.googleCredentials` → `headers` resolver. Reusing
    // `baseProvider.languageModel` preserves `fetch`, `buildRequestUrl`,
    // `transformRequestBody` (`anthropic_version: vertex-2023-10-16`),
    // `supportsStrictTools: false`, and the authenticated `headers`.
    // Only patch the flags that differ from upstream:
    // - Keep native structured output disabled (defense-in-depth; upstream
    //   already sets this, but we enforce it so future SDK bumps can't
    //   reintroduce the `structured-outputs-2025-11-13` beta header that
    //   Vertex rejects — see issue #14645).
    // - Enable `image/*` URL passthrough. Upstream Vertex intentionally sets
    //   `supportedUrls: () => ({})` to force download→base64. Cherry's
    //   chat pipeline already converts image URLs to base64 before the SDK
    //   call (see `downloadImageAsBase64` in `AiService`), so passthrough
    //   is safe and avoids double-download; if that pre-conversion is ever
    //   removed, this must revert to `() => ({})` or Vertex will 400.
    const config = model.config
    if (!config) {
      throw new Error(
        'createGoogleVertexAnthropic: failed to patch AnthropicMessagesLanguageModel — `config` is missing (SDK changed its internal shape). This would silently re-enable native structured output on Vertex.'
      )
    }

    // If SDK freezes `config` in a future bump, direct mutation would throw
    // `TypeError` and turn the bump into a 100% Vertex outage. Detect that
    // proactively and fall back to a fresh model with a shallow-copied config.
    if (!Object.isExtensible(config) || Object.isFrozen(config)) {
      try {
        return new AnthropicMessagesLanguageModel(modelId, {
          ...(config as Record<string, unknown>),
          supportsNativeStructuredOutput: false,
          supportsStrictTools: false,
          supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] })
        } as unknown as ConstructorParameters<typeof AnthropicMessagesLanguageModel>[1])
      } catch {
        throw new Error(
          'createGoogleVertexAnthropic: failed to patch AnthropicMessagesLanguageModel — `config` is frozen and fallback construction failed (SDK changed its internal shape).'
        )
      }
    }

    config.supportsNativeStructuredOutput = false
    config.supportsStrictTools = false
    config.supportedUrls = () => ({ 'image/*': [/^https?:\/\/.*$/] })

    return model
  }

  // Preserve callable `provider(modelId)` and all SDK properties (tools,
  // embeddingModel, etc.) while overriding every chat entry point.
  // Use descriptors so non-enumerable/symbol props from the SDK aren't dropped.
  // Must use function (not arrow) to preserve `new.target` guard matching
  // upstream `createVertexAnthropic` which throws on `new provider()`.
  function provider(modelId: string): LanguageModelV3 {
    if (new.target) {
      throw new Error('The Anthropic model function cannot be called with the new keyword.')
    }
    return patchedLanguageModel(modelId)
  }

  const providerInstance = provider as unknown as GoogleVertexAnthropicProvider

  // Copy all SDK properties except function-intrinsics (`length`/`name`/`prototype`)
  // and the three factories we will override, so patched versions keep their
  // own descriptors and don't get overwritten by the unpatched ones.
  const baseDescriptors = Object.getOwnPropertyDescriptors(baseProvider)
  for (const key of ['length', 'name', 'prototype', 'languageModel', 'chat', 'messages'] as const) {
    delete (baseDescriptors as Record<string, unknown>)[key]
  }
  Object.defineProperties(providerInstance, baseDescriptors)
  Object.defineProperties(providerInstance, {
    languageModel: { value: patchedLanguageModel, writable: true, enumerable: true, configurable: true },
    chat: { value: patchedLanguageModel, writable: true, enumerable: true, configurable: true },
    messages: { value: patchedLanguageModel, writable: true, enumerable: true, configurable: true }
  } as PropertyDescriptorMap)

  return providerInstance
}
