import AiProvider from '@renderer/aiCore'
import { CompletionsParams } from '@renderer/aiCore/middleware/schemas'
import {
  isOpenAIDeepResearchModel,
  isReasoningModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel
} from '@renderer/config/models'
import { DEEP_RESEARCH_CLARIFICATION_PROMPT, DEEP_RESEARCH_PROMPT_REWRITE_PROMPT } from '@renderer/config/prompts'
import { Assistant, Message } from '@renderer/types'
import { Chunk } from '@renderer/types/chunk'
import { findLast } from 'lodash'

import { fetchChatCompletion } from './ApiService'
import { getAssistantProvider, getDefaultAssistant, getDefaultModel, getTopNamingModel } from './AssistantService'

interface DeepResearchCallbacks {
  onResearchStarted: () => Promise<string | undefined> // 返回用户补全信息
  onResponse: (text: string, isComplete: boolean) => void
  onChunkReceived: (chunk: Chunk) => void
}

// 澄清阶段：生成澄清问题
export async function fetchDeepResearchClarification({
  messages,
  assistant,
  onResponse
}: {
  messages: Message[]
  assistant: Assistant
  onResponse: (text: string, isComplete: boolean) => void
}) {
  const clarificationAssistant = getDefaultAssistant()
  const model = getTopNamingModel() || getDefaultModel()
  clarificationAssistant.model = model
  clarificationAssistant.prompt = DEEP_RESEARCH_CLARIFICATION_PROMPT

  const lastUserMessage = findLast(messages, (m) => m.role === 'user')
  if (!lastUserMessage) {
    throw new Error('No user message found for clarification')
  }

  const enableReasoning =
    ((isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)) &&
      assistant.settings?.reasoning_effort !== undefined) ||
    (isReasoningModel(model) && (!isSupportedThinkingTokenModel(model) || !isSupportedReasoningEffortModel(model)))

  const params: CompletionsParams = {
    callType: 'chat',
    messages: [lastUserMessage],
    onResponse: onResponse,
    assistant: clarificationAssistant,
    streamOutput: assistant.settings?.streamOutput || false,
    enableReasoning
  }

  const provider = getAssistantProvider(clarificationAssistant)
  const AI = new AiProvider(provider)

  const result = await AI.completions(params, {
    streamOutput: assistant.settings?.streamOutput || false
  })
  return result.getText()
}

// 提示词重写阶段
export async function fetchDeepResearchPromptRewrite(
  clarificationAnswers: string,
  userSupplementInfo?: string
): Promise<string> {
  const rewriteAssistant = getDefaultAssistant()
  rewriteAssistant.model = getTopNamingModel() || getDefaultModel()

  rewriteAssistant.prompt = DEEP_RESEARCH_PROMPT_REWRITE_PROMPT

  // 构建包含澄清答案和用户补全信息的完整内容
  let contentForRewrite = clarificationAnswers
  if (userSupplementInfo && userSupplementInfo.trim()) {
    contentForRewrite += `\n\n用户补充信息：\n${userSupplementInfo.trim()}`
  }

  const params: CompletionsParams = {
    callType: 'summary',
    messages: contentForRewrite,
    assistant: rewriteAssistant,
    streamOutput: false,
    enableReasoning: false
  }

  const provider = getAssistantProvider(rewriteAssistant)
  const AI = new AiProvider(provider)

  try {
    const result = await AI.completions(params)
    const rewrittenPrompt = result.getText()

    return rewrittenPrompt
  } catch (error: any) {
    console.error('Prompt rewrite phase failed:', error)
    return contentForRewrite
  }
}

// 主要的Deep Research函数
export async function fetchDeepResearch({
  messages,
  assistant,
  callbacks
}: {
  messages: Message[]
  assistant: Assistant
  callbacks: DeepResearchCallbacks
}) {
  const model = assistant.model || getDefaultModel()
  if (!isOpenAIDeepResearchModel(model)) {
    throw new Error('Model is not supported for deep research')
  }

  const lastUserMessage = findLast(messages, (m) => m.role === 'user')
  if (!lastUserMessage) {
    throw new Error('No user message found for deep research')
  }

  try {
    // 阶段1：澄清用户意图
    const clarificationAnswers = await fetchDeepResearchClarification({
      messages,
      assistant,
      onResponse: callbacks.onResponse
    })

    // 等待用户确认并获取补全信息
    const userSupplementInfo = await callbacks.onResearchStarted()

    // 阶段2：重写提示词
    const rewrittenPrompt = await fetchDeepResearchPromptRewrite(clarificationAnswers, userSupplementInfo)

    // 使用增强后的提示词调用Deep Research模型
    await fetchChatCompletion({
      messages: [lastUserMessage],
      assistant: {
        ...assistant,
        prompt: rewrittenPrompt
      },
      onChunkReceived: callbacks.onChunkReceived
    })
  } catch (error: any) {
    console.error('Deep research failed:', error)
    throw error
  }
}
