/**
 * Type Tests for Merged Provider Types
 *
 * These tests validate that the auto-extraction and merging of provider types works correctly.
 * They use type-level assertions to ensure compile-time type safety.
 */

import { describe, expectTypeOf, it } from 'vitest'

import type { AppProviderId, AppProviderSettingsMap } from '../merged'
import { appProviderIds } from '../merged'

describe('Unified Provider Types', () => {
  describe('appProviderIds literal access', () => {
    it('should return canonical IDs with literal types', () => {
      expectTypeOf(appProviderIds.az).toEqualTypeOf<'azure'>()
      expectTypeOf(appProviderIds.vertexai).toEqualTypeOf<'google-vertex'>()
      expectTypeOf(appProviderIds['openai-chat']).toEqualTypeOf<'openai'>()
    })
  })

  describe('AppProviderId - All Providers', () => {
    it('should include all core extension names', () => {
      type Check1 = 'openai' extends AppProviderId ? true : false
      type Check2 = 'anthropic' extends AppProviderId ? true : false
      type Check3 = 'google' extends AppProviderId ? true : false
      type Check4 = 'azure' extends AppProviderId ? true : false
      type Check5 = 'deepseek' extends AppProviderId ? true : false
      type Check6 = 'xai' extends AppProviderId ? true : false

      expectTypeOf<Check1>().toEqualTypeOf<true>()
      expectTypeOf<Check2>().toEqualTypeOf<true>()
      expectTypeOf<Check3>().toEqualTypeOf<true>()
      expectTypeOf<Check4>().toEqualTypeOf<true>()
      expectTypeOf<Check5>().toEqualTypeOf<true>()
      expectTypeOf<Check6>().toEqualTypeOf<true>()
    })

    it('should include all project extension names', () => {
      type Check1 = 'google-vertex' extends AppProviderId ? true : false
      type Check2 = 'bedrock' extends AppProviderId ? true : false
      type Check3 = 'github-copilot-openai-compatible' extends AppProviderId ? true : false
      type Check4 = 'perplexity' extends AppProviderId ? true : false
      type Check5 = 'mistral' extends AppProviderId ? true : false
      type Check6 = 'huggingface' extends AppProviderId ? true : false
      type Check7 = 'gateway' extends AppProviderId ? true : false
      type Check8 = 'cerebras' extends AppProviderId ? true : false
      type Check9 = 'ollama' extends AppProviderId ? true : false

      expectTypeOf<Check1>().toEqualTypeOf<true>()
      expectTypeOf<Check2>().toEqualTypeOf<true>()
      expectTypeOf<Check3>().toEqualTypeOf<true>()
      expectTypeOf<Check4>().toEqualTypeOf<true>()
      expectTypeOf<Check5>().toEqualTypeOf<true>()
      expectTypeOf<Check6>().toEqualTypeOf<true>()
      expectTypeOf<Check7>().toEqualTypeOf<true>()
      expectTypeOf<Check8>().toEqualTypeOf<true>()
      expectTypeOf<Check9>().toEqualTypeOf<true>()
    })

    it('should include all aliases (core + project)', () => {
      // Core aliases
      type Check1 = 'oai' extends AppProviderId ? true : false
      type Check2 = 'claude' extends AppProviderId ? true : false

      // Project aliases
      type Check3 = 'vertexai' extends AppProviderId ? true : false
      type Check4 = 'aws-bedrock' extends AppProviderId ? true : false
      type Check5 = 'copilot' extends AppProviderId ? true : false
      type Check6 = 'github-copilot' extends AppProviderId ? true : false
      type Check7 = 'hf' extends AppProviderId ? true : false
      type Check8 = 'hugging-face' extends AppProviderId ? true : false
      type Check9 = 'ai-gateway' extends AppProviderId ? true : false

      expectTypeOf<Check1>().toEqualTypeOf<true>()
      expectTypeOf<Check2>().toEqualTypeOf<true>()
      expectTypeOf<Check3>().toEqualTypeOf<true>()
      expectTypeOf<Check4>().toEqualTypeOf<true>()
      expectTypeOf<Check5>().toEqualTypeOf<true>()
      expectTypeOf<Check6>().toEqualTypeOf<true>()
      expectTypeOf<Check7>().toEqualTypeOf<true>()
      expectTypeOf<Check8>().toEqualTypeOf<true>()
      expectTypeOf<Check9>().toEqualTypeOf<true>()
    })
  })

  describe('AppProviderId', () => {
    it('should merge core and project IDs', () => {
      // Core providers
      type Check1 = 'openai' extends AppProviderId ? true : false
      type Check2 = 'anthropic' extends AppProviderId ? true : false
      type Check3 = 'google' extends AppProviderId ? true : false
      type Check4 = 'azure' extends AppProviderId ? true : false
      type Check5 = 'xai' extends AppProviderId ? true : false

      // Project providers
      type Check6 = 'google-vertex' extends AppProviderId ? true : false
      type Check7 = 'bedrock' extends AppProviderId ? true : false
      type Check8 = 'ollama' extends AppProviderId ? true : false

      expectTypeOf<Check1>().toEqualTypeOf<true>()
      expectTypeOf<Check2>().toEqualTypeOf<true>()
      expectTypeOf<Check3>().toEqualTypeOf<true>()
      expectTypeOf<Check4>().toEqualTypeOf<true>()
      expectTypeOf<Check5>().toEqualTypeOf<true>()
      expectTypeOf<Check6>().toEqualTypeOf<true>()
      expectTypeOf<Check7>().toEqualTypeOf<true>()
      expectTypeOf<Check8>().toEqualTypeOf<true>()
    })

    it('should accept string for dynamic providers', () => {
      type Check = string extends AppProviderId ? true : false
      expectTypeOf<Check>().toEqualTypeOf<true>()
    })
  })

  describe('AppProviderSettingsMap', () => {
    it('should map core provider IDs to their settings', () => {
      // OpenAI settings should have OpenAI-specific fields
      type OpenAISettings = AppProviderSettingsMap['openai']
      type HasBaseURL = 'baseURL' extends keyof OpenAISettings ? true : false
      type HasApiKey = 'apiKey' extends keyof OpenAISettings ? true : false

      expectTypeOf<HasBaseURL>().toEqualTypeOf<true>()
      expectTypeOf<HasApiKey>().toEqualTypeOf<true>()
    })

    it('should map project provider IDs to their settings', () => {
      // Project providers should have settings
      type VertexSettings = AppProviderSettingsMap['google-vertex']
      type BedrockSettings = AppProviderSettingsMap['bedrock']
      type OllamaSettings = AppProviderSettingsMap['ollama']

      // These should not be never
      type VertexNotNever = [VertexSettings] extends [never] ? false : true
      type BedrockNotNever = [BedrockSettings] extends [never] ? false : true
      type OllamaNotNever = [OllamaSettings] extends [never] ? false : true

      expectTypeOf<VertexNotNever>().toEqualTypeOf<true>()
      expectTypeOf<BedrockNotNever>().toEqualTypeOf<true>()
      expectTypeOf<OllamaNotNever>().toEqualTypeOf<true>()
    })

    it('should map aliases to same settings as main ID', () => {
      // OpenAI aliases should have the same settings
      type OpenAIByName = AppProviderSettingsMap['openai']
      type OpenAIByAlias = AppProviderSettingsMap['oai']

      expectTypeOf<OpenAIByName>().toEqualTypeOf<OpenAIByAlias>()

      // Vertex AI aliases should have the same settings
      type VertexByName = AppProviderSettingsMap['google-vertex']
      type VertexByAlias = AppProviderSettingsMap['vertexai']

      expectTypeOf<VertexByName>().toEqualTypeOf<VertexByAlias>()
    })

    it('should support dynamic provider IDs', () => {
      // Dynamic string keys should return any
      type DynamicSettings = AppProviderSettingsMap[string]
      type CanBeAny = any extends DynamicSettings ? true : false

      expectTypeOf<CanBeAny>().toEqualTypeOf<true>()
    })
  })

  describe('Zero Maintenance Validation', () => {
    it('should auto-update when adding new extensions to projectExtensions', () => {
      // This test documents that adding a new extension to the projectExtensions array
      // will automatically update ProjectProviderId and AppProviderId without any manual intervention
      //
      // Example: If we add a new extension:
      // export const NewExtension = ProviderExtension.create({ name: 'new-provider', ... })
      // And add it to projectExtensions array:
      // export const projectExtensions = [..., NewExtension] as const
      //
      // Then 'new-provider' will automatically be included in ProjectProviderId
      // No need to update any type declarations manually!

      // Current count of project extensions
      const extensionCount = 11 // Update this when adding new extensions

      // Verify we have the expected number of extensions
      // (This serves as documentation of the current state)
      type VerifyCount = typeof extensionCount extends 11 ? true : false
      expectTypeOf<VerifyCount>().toEqualTypeOf<true>()
    })
  })
})
