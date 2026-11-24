/**
 * Provider Types - Type-level Tests
 * Tests type utilities and type inference for provider extensions
 */

import type { ProviderV3 } from '@ai-sdk/provider'
import { describe, expectTypeOf, it } from 'vitest'

import type { ProviderExtensionConfig } from '../core/ProviderExtension'
import type {
  ExtensionConfigToIdResolutionMap,
  ExtractExtensionIds,
  ExtractProviderIds,
  StringKeys,
  UnionToIntersection
} from '../types'

describe('Type Utilities', () => {
  describe('StringKeys<T>', () => {
    it('should extract only string keys from object type', () => {
      type TestObj = { foo: 1; bar: 2; 0: 3; 1: 4 }
      type Result = StringKeys<TestObj>

      expectTypeOf<Result>().toEqualTypeOf<'foo' | 'bar'>()
    })

    it('should return never for object with no string keys', () => {
      type TestObj = { 0: 'a'; 1: 'b' }
      type Result = StringKeys<TestObj>

      expectTypeOf<Result>().toEqualTypeOf<never>()
    })

    it('should handle empty object', () => {
      type Result = StringKeys<{}>

      expectTypeOf<Result>().toEqualTypeOf<never>()
    })

    it('should preserve literal string keys', () => {
      type TestObj = { openai: 1; anthropic: 2; google: 3 }
      type Result = StringKeys<TestObj>

      expectTypeOf<Result>().toEqualTypeOf<'openai' | 'anthropic' | 'google'>()
    })
  })

  describe('UnionToIntersection<U>', () => {
    it('should convert union to intersection', () => {
      type Union = { a: 1 } | { b: 2 }
      type Result = UnionToIntersection<Union>

      expectTypeOf<Result>().toEqualTypeOf<{ a: 1 } & { b: 2 }>()
    })

    it('should handle single type', () => {
      type Single = { a: 1 }
      type Result = UnionToIntersection<Single>

      expectTypeOf<Result>().toEqualTypeOf<{ a: 1 }>()
    })
  })

  describe('ExtractProviderIds<TConfig>', () => {
    it('should extract base name', () => {
      type Config = { name: 'openai' }
      type Result = ExtractProviderIds<Config>

      expectTypeOf<Result>().toEqualTypeOf<'openai'>()
    })

    it('should extract name and aliases', () => {
      type Config = { name: 'anthropic'; aliases: readonly ['claude'] }
      type Result = ExtractProviderIds<Config>

      expectTypeOf<Result>().toEqualTypeOf<'anthropic' | 'claude'>()
    })

    it('should extract name and variants', () => {
      type Config = { name: 'openai'; variants: readonly [{ suffix: 'chat' }] }
      type Result = ExtractProviderIds<Config>

      expectTypeOf<Result>().toEqualTypeOf<'openai' | 'openai-chat'>()
    })

    it('should extract name, aliases, and variants', () => {
      type Config = {
        name: 'azure'
        aliases: readonly ['azure-openai']
        variants: readonly [{ suffix: 'responses' }]
      }
      type Result = ExtractProviderIds<Config>

      expectTypeOf<Result>().toEqualTypeOf<'azure' | 'azure-openai' | 'azure-responses'>()
    })

    it('should handle multiple variants', () => {
      type Config = {
        name: 'openai'
        variants: readonly [{ suffix: 'chat' }, { suffix: 'responses' }]
      }
      type Result = ExtractProviderIds<Config>

      expectTypeOf<Result>().toEqualTypeOf<'openai' | 'openai-chat' | 'openai-responses'>()
    })
  })

  describe('ExtensionConfigToIdResolutionMap<TConfig>', () => {
    it('should map base name to itself', () => {
      type Config = { name: 'openai' }
      type Result = ExtensionConfigToIdResolutionMap<Config>

      expectTypeOf<Result>().toEqualTypeOf<{ readonly openai: 'openai' }>()
    })

    it('should map aliases to base name', () => {
      type Config = { name: 'anthropic'; aliases: readonly ['claude'] }
      type Result = ExtensionConfigToIdResolutionMap<Config>

      expectTypeOf<Result>().toEqualTypeOf<{
        readonly anthropic: 'anthropic'
        readonly claude: 'anthropic'
      }>()
    })

    it('should map variants to themselves (self-referential)', () => {
      type Config = { name: 'azure'; variants: readonly [{ suffix: 'responses' }] }
      type Result = ExtensionConfigToIdResolutionMap<Config>

      expectTypeOf<Result>().toEqualTypeOf<{
        readonly azure: 'azure'
        readonly 'azure-responses': 'azure-responses'
      }>()
    })

    it('should handle combined aliases and variants correctly', () => {
      type Config = {
        name: 'azure'
        aliases: readonly ['azure-openai']
        variants: readonly [{ suffix: 'responses' }]
      }
      type Result = ExtensionConfigToIdResolutionMap<Config>

      expectTypeOf<Result>().toEqualTypeOf<{
        readonly azure: 'azure'
        readonly 'azure-openai': 'azure'
        readonly 'azure-responses': 'azure-responses'
      }>()
    })
  })

  describe('ExtractExtensionIds<T>', () => {
    it('should extract IDs from extension with config property', () => {
      type MockExtension = {
        config: { name: 'test'; aliases: readonly ['test-alias'] }
      }
      type Result = ExtractExtensionIds<MockExtension>

      expectTypeOf<Result>().toEqualTypeOf<'test' | 'test-alias'>()
    })
  })
})

describe('ProviderExtensionConfig Type Constraints', () => {
  it('should accept valid minimal config', () => {
    type ValidConfig = ProviderExtensionConfig<{ apiKey: string }, ProviderV3, 'test'>

    // Should compile without errors
    const config: ValidConfig = {
      name: 'test',
      create: () => ({}) as ProviderV3
    }

    expectTypeOf(config.name).toEqualTypeOf<'test'>()
  })
})
