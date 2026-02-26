/**
 * Type System Tests for Auto-Extracted Provider Types
 */

import type { AppProviderId } from '@renderer/aiCore/types'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { extensions } from '../index'

describe('Auto-Extracted Type System', () => {
  describe('Runtime and Type Consistency', () => {
    it('运行时 IDs 应该自动提取到类型系统', () => {
      // 从运行时获取所有 IDs（包括主 ID 和别名）
      const runtimeIds = extensions.flatMap((ext) => ext.getProviderIds())

      // 🎯 Zero maintenance - 不再需要手动声明类型！
      // 类型系统会自动从 projectExtensions 数组中提取所有 IDs

      // 验证主要的 project provider IDs
      const expectedMainIds: AppProviderId[] = [
        'google-vertex',
        'google-vertex-anthropic',
        'azure-anthropic',
        'github-copilot-openai-compatible',
        'bedrock',
        'perplexity',
        'mistral',
        'huggingface',
        'gateway',
        'cerebras',
        'ollama'
      ]

      // 验证别名
      const expectedAliases: AppProviderId[] = [
        'vertexai',
        'vertexai-anthropic',
        'copilot',
        'github-copilot',
        'aws-bedrock',
        'hf',
        'hugging-face',
        'ai-gateway'
      ]

      // 验证所有期望的 ID 都存在于运行时
      ;[...expectedMainIds, ...expectedAliases].forEach((id) => {
        expect(runtimeIds).toContain(id)
      })

      // 验证数量一致
      const uniqueRuntimeIds = [...new Set(runtimeIds)]
      expect(uniqueRuntimeIds.length).toBeGreaterThanOrEqual(expectedMainIds.length + expectedAliases.length)
    })

    it('每个 extension 应该至少有一个 provider ID', () => {
      extensions.forEach((ext) => {
        const ids = ext.getProviderIds()
        expect(ids.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Type Inference - Auto-Extracted', () => {
    // 🎯 Zero maintenance! These tests validate compile-time type inference
    // 类型从 projectExtensions 数组自动提取，无需手动维护

    it('应该接受核心 provider IDs', () => {
      // 编译时类型检查 - AppProviderId 包含所有 core IDs
      const coreIds: AppProviderId[] = [
        'openai',
        'anthropic',
        'google',
        'azure',
        'deepseek',
        'xai',
        'openai-compatible',
        'openrouter',
        'cherryin'
      ]

      // 运行时验证（确保类型存在）
      expect(coreIds.length).toBeGreaterThan(0)
    })

    it('应该接受项目特定 provider IDs', () => {
      // 编译时类型检查 - 自动从 projectExtensions 提取
      const projectIds: AppProviderId[] = [
        'google-vertex',
        'google-vertex-anthropic',
        'azure-anthropic',
        'github-copilot-openai-compatible',
        'bedrock',
        'perplexity',
        'mistral',
        'huggingface',
        'gateway',
        'cerebras',
        'ollama'
      ]

      // 运行时验证
      expect(projectIds.length).toBe(11)
    })

    it('应该接受项目特定 provider 别名', () => {
      // 编译时类型检查 - 别名也自动提取
      const aliases: AppProviderId[] = [
        'vertexai',
        'vertexai-anthropic',
        'copilot',
        'github-copilot',
        'aws-bedrock',
        'hf',
        'hugging-face',
        'ai-gateway'
      ]

      // 运行时验证
      expect(aliases.length).toBe(8)
    })

    it('AppProviderId 应该包含项目和核心的所有 IDs', () => {
      // 编译时验证 - 统一类型系统测试
      // ✅ 项目 IDs 应该在 AppProviderId 中
      type Check1 = 'google-vertex' extends AppProviderId ? true : false
      type Check2 = 'ollama' extends AppProviderId ? true : false
      type Check3 = 'vertexai' extends AppProviderId ? true : false

      // ✅ 核心 IDs 也应该在 AppProviderId 中（统一类型系统）
      type Check4 = 'openai' extends AppProviderId ? true : false
      type Check5 = 'anthropic' extends AppProviderId ? true : false

      expectTypeOf<Check1>().toEqualTypeOf<true>()
      expectTypeOf<Check2>().toEqualTypeOf<true>()
      expectTypeOf<Check3>().toEqualTypeOf<true>()
      expectTypeOf<Check4>().toEqualTypeOf<true>()
      expectTypeOf<Check5>().toEqualTypeOf<true>()
    })
  })
})
