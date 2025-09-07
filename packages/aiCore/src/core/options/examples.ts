import { streamText } from 'ai'

import {
  createAnthropicOptions,
  createGenericProviderOptions,
  createGoogleOptions,
  createOpenAIOptions,
  mergeProviderOptions
} from './factory'

// 示例1: 使用已知供应商的严格类型约束
export function exampleOpenAIWithOptions() {
  const openaiOptions = createOpenAIOptions({
    reasoningEffort: 'medium'
  })

  // 这里会有类型检查，确保选项符合OpenAI的设置
  return streamText({
    model: {} as any, // 实际使用时替换为真实模型
    prompt: 'Hello',
    providerOptions: openaiOptions
  })
}

// 示例2: 使用Anthropic供应商选项
export function exampleAnthropicWithOptions() {
  const anthropicOptions = createAnthropicOptions({
    thinking: {
      type: 'enabled',
      budgetTokens: 1000
    }
  })

  return streamText({
    model: {} as any,
    prompt: 'Hello',
    providerOptions: anthropicOptions
  })
}

// 示例3: 使用Google供应商选项
export function exampleGoogleWithOptions() {
  const googleOptions = createGoogleOptions({
    thinkingConfig: {
      includeThoughts: true,
      thinkingBudget: 1000
    }
  })

  return streamText({
    model: {} as any,
    prompt: 'Hello',
    providerOptions: googleOptions
  })
}

// 示例4: 使用未知供应商（通用类型）
export function exampleUnknownProviderWithOptions() {
  const customProviderOptions = createGenericProviderOptions('custom-provider', {
    temperature: 0.7,
    customSetting: 'value',
    anotherOption: true
  })

  return streamText({
    model: {} as any,
    prompt: 'Hello',
    providerOptions: customProviderOptions
  })
}

// 示例5: 合并多个供应商选项
export function exampleMergedOptions() {
  const openaiOptions = createOpenAIOptions({})

  const customOptions = createGenericProviderOptions('custom', {
    customParam: 'value'
  })

  const mergedOptions = mergeProviderOptions(openaiOptions, customOptions)

  return streamText({
    model: {} as any,
    prompt: 'Hello',
    providerOptions: mergedOptions
  })
}
