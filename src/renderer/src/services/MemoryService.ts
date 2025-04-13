// Import database for topic access
import { TopicManager } from '@renderer/hooks/useTopic' // Import TopicManager
import { fetchGenerate } from '@renderer/services/ApiService' // Import fetchGenerate instead of AiProvider
// Import getProviderByModel
import { useAppDispatch, useAppSelector } from '@renderer/store'
// Removed duplicate import: import store from '@renderer/store';
import store from '@renderer/store' // Import store
import {
  addAnalysisLatency,
  addMemory,
  addShortMemory,
  setAnalyzing,
  updateAnalysisStats,
  updatePerformanceMetrics,
  updateUserInterest,
  updateMemoryPriorities,
  accessMemory,
  Memory,
  saveMemoryData // <-- 添加 saveMemoryData
} from '@renderer/store/memory'
import { useCallback, useEffect, useRef } from 'react' // Add useRef back

// 计算对话复杂度，用于调整分析深度
const calculateConversationComplexity = (conversation: string): 'low' | 'medium' | 'high' => {
  const wordCount = conversation.split(/\s+/).length
  const sentenceCount = conversation.split(/[.!?]+/).length
  const avgSentenceLength = wordCount / (sentenceCount || 1)

  // 简单的复杂度评估算法
  if (wordCount < 100 || avgSentenceLength < 5) {
    return 'low'
  } else if (wordCount > 500 || avgSentenceLength > 15) {
    return 'high'
  } else {
    return 'medium'
  }
}

// 根据分析深度调整提示词
const adjustPromptForDepth = (basePrompt: string, depth: 'low' | 'medium' | 'high'): string => {
  switch (depth) {
    case 'low':
      // 简化提示词，减少分析要求
      return basePrompt
        .replace(/\u8be6\u7ec6\u5206\u6790/g, '\u7b80\u8981\u5206\u6790')
        .replace(/\u63d0\u53d6\u51fa\u91cd\u8981\u7684/g, '\u63d0\u53d6\u51fa\u6700\u91cd\u8981\u7684')
    case 'high':
      // 增强提示词，要求更深入的分析
      return (
        basePrompt +
        '\n\n\u8bf7\u8fdb\u884c\u66f4\u6df1\u5165\u7684\u5206\u6790\uff0c\u8003\u8651\u9690\u542b\u7684\u7528\u6237\u9700\u6c42\u548c\u504f\u597d\uff0c\u8bc6\u522b\u6f5c\u5728\u7684\u5173\u8054\u4fe1\u606f\u3002'
      )
    default:
      return basePrompt
  }
}

// 提取用户关注点
const extractUserInterests = (conversation: string): string[] => {
  // 简单实现：提取对话中的关键词或主题
  const topics = new Set<string>()

  // 简单的关键词提取，匹配4个或更多字符的单词
  const keywords = conversation.match(/\b\w{4,}\b/g) || []
  const commonWords = ['this', 'that', 'these', 'those', 'with', 'from', 'have', 'what', 'when', 'where', 'which']

  keywords.forEach((word) => {
    if (!commonWords.includes(word.toLowerCase())) {
      topics.add(word.toLowerCase())
    }
  })

  return Array.from(topics)
}

// 分析对话内容并提取重要信息
const analyzeConversation = async (
  conversation: string,
  modelId: string,
  customPrompt?: string
): Promise<Array<{ content: string; category: string }>> => {
  try {
    // 使用自定义提示词或默认提示词
    const prompt =
      customPrompt ||
      `
请分析以下对话内容，提取出重要的用户偏好、习惯、需求和背景信息，这些信息在未来的对话中可能有用。

将每条信息分类并按以下格式返回：
类别: 信息内容

类别应该是以下几种之一：
- 用户偏好：用户喜好、喜欢的事物、风格等
- 技术需求：用户的技术相关需求、开发偏好等
- 个人信息：用户的背景、经历等个人信息
- 交互偏好：用户喜欢的交流方式、沟通风格等
- 其他：不属于以上类别的重要信息

请确保每条信息都是简洁、准确的。如果没有找到重要信息，请返回空字符串。

对话内容:
${conversation}
`
    console.log(`[Memory Analysis] Analyzing conversation using model: ${modelId}`)

    // 获取模型和提供者
    // 检查模型是否存在
    const model = store
      .getState()
      .llm.providers // Access store directly
      .flatMap((provider) => provider.models)
      .find((model) => model.id === modelId)

    if (!model) {
      console.error(`[Memory Analysis] Model ${modelId} not found`)
      return []
    }

    // 创建一个简单的助手对象或直接传递必要参数给API调用
    // 注意：AiProvider的generateText可能不需要完整的assistant对象结构
    // 根据 AiProvider.generateText 的实际需要调整参数
    console.log('[Memory Analysis] Calling AI.generateText...')
    // 使用指定的模型进行分析
    const result = await fetchGenerate({
      prompt: prompt,
      content: conversation,
      modelId: modelId // 传递指定的模型 ID
    })
    console.log('[Memory Analysis] AI.generateText response:', result)

    // 处理响应
    if (!result) {
      // Check if result is null or undefined
      console.log('[Memory Analysis] No result from AI analysis.')
      return []
    }

    // 将响应拆分为单独的记忆项并分类
    const lines = result
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean) // 过滤掉空行

    const memories: Array<{ content: string; category: string }> = []

    for (const line of lines) {
      // 匹配格式：类别: 信息内容
      const match = line.match(/^([^:]+):\s*(.+)$/)
      if (match) {
        const category = match[1].trim()
        const content = match[2].trim()
        memories.push({ content, category })
      }
    }

    return memories
  } catch (error) {
    console.error('Failed to analyze conversation with real AI:', error)
    // Consider logging the specific error details if possible
    // e.g., console.error('Error details:', JSON.stringify(error, null, 2));
    return [] as Array<{ content: string; category: string }> // Return empty array on error
  }
}

// These imports are duplicates, removing them.
// Removed duplicate import: import store from '@renderer/store';

// This function definition is a duplicate, removing it.

// 记忆服务钩子 - 重构版
export const useMemoryService = () => {
  const dispatch = useAppDispatch()
  // 获取设置状态
  const isActive = useAppSelector((state) => state.memory?.isActive || false)
  const autoAnalyze = useAppSelector((state) => state.memory?.autoAnalyze || false)
  const analyzeModel = useAppSelector((state) => state.memory?.analyzeModel || null)

  // 使用 useCallback 定义分析函数，但减少依赖项
  // 增加可选的 topicId 参数，允许分析指定的话题
  const analyzeAndAddMemories = useCallback(
    async (topicId?: string) => {
      // 如果没有提供话题ID，则使用当前话题
      // 在函数执行时获取最新状态
      const currentState = store.getState() // Use imported store
      const memoryState = currentState.memory || {}
      const messagesState = currentState.messages || {}

      // 检查isAnalyzing状态是否卡住（超过1分钟）
      if (memoryState.isAnalyzing && memoryState.lastAnalyzeTime) {
        const now = Date.now()
        const analyzeTime = memoryState.lastAnalyzeTime
        if (now - analyzeTime > 1 * 60 * 1000) {
          // 1分钟超时
          console.log('[Memory Analysis] Analysis state stuck, resetting...')
          dispatch(setAnalyzing(false))
        }
      }

      // 重新检查条件
      if (!memoryState.isActive || !memoryState.autoAnalyze || !memoryState.analyzeModel || memoryState.isAnalyzing) {
        console.log('[Memory Analysis] Conditions not met or already analyzing at time of call:', {
          isActive: memoryState.isActive,
          autoAnalyze: memoryState.autoAnalyze,
          analyzeModel: memoryState.analyzeModel,
          isAnalyzing: memoryState.isAnalyzing
        })
        return
      }

      // 获取对话内容
      let messages: any[] = []
      const targetTopicId = topicId || messagesState.currentTopic?.id

      if (targetTopicId) {
        // 如果提供了话题ID，先尝试从 Redux store 中获取
        if (messagesState.messagesByTopic && messagesState.messagesByTopic[targetTopicId]) {
          messages = messagesState.messagesByTopic[targetTopicId] || []
        } else {
          // 如果 Redux store 中没有，则从数据库中获取
          try {
            const topicMessages = await TopicManager.getTopicMessages(targetTopicId)
            if (topicMessages && topicMessages.length > 0) {
              messages = topicMessages
            }
          } catch (error) {
            console.error(`[Memory Analysis] Failed to get messages for topic ${targetTopicId}:`, error)
          }
        }
      }

      if (!messages || messages.length === 0) {
        console.log('[Memory Analysis] No messages to analyze.')
        return
      }

      // 获取现有的长期记忆
      const existingMemories = store.getState().memory?.memories || []
      const topicMemories = existingMemories.filter((memory) => memory.topicId === targetTopicId)

      // 收集所有已分析过的消息ID
      const analyzedMessageIds = new Set<string>()
      topicMemories.forEach((memory) => {
        if (memory.analyzedMessageIds) {
          memory.analyzedMessageIds.forEach((id) => analyzedMessageIds.add(id))
        }
      })

      // 找出未分析过的新消息
      const newMessages = messages.filter((msg) => !analyzedMessageIds.has(msg.id))

      if (newMessages.length === 0) {
        console.log('[Memory Analysis] No new messages to analyze.')
        return
      }

      console.log(`[Memory Analysis] Found ${newMessages.length} new messages to analyze.`)

      // 构建新消息的对话内容
      const newConversation = newMessages.map((msg) => `${msg.role || 'user'}: ${msg.content || ''}`).join('\n')

      // 获取已有的长期记忆内容
      const existingMemoriesContent = topicMemories
        .map((memory) => `${memory.category || '其他'}: ${memory.content}`)
        .join('\n')

      if (!newConversation) {
        console.log('[Memory Analysis] No conversation content to analyze.')
        return
      }

      try {
        // 性能监控：记录开始时间
        const startTime = performance.now()

        dispatch(setAnalyzing(true))
        console.log('[Memory Analysis] Starting analysis...')
        console.log(`[Memory Analysis] Analyzing topic: ${targetTopicId}`)
        console.log('[Memory Analysis] Conversation length:', newConversation.length)

        // 自适应分析：根据对话复杂度调整分析深度
        const conversationComplexity = calculateConversationComplexity(newConversation)
        let analysisDepth = memoryState.analysisDepth || 'medium'

        // 如果启用了自适应分析，根据复杂度调整深度
        if (memoryState.adaptiveAnalysisEnabled) {
          analysisDepth = conversationComplexity
          console.log(`[Memory Analysis] Adjusted analysis depth to ${analysisDepth} based on conversation complexity`)
        }

        // 构建长期记忆分析提示词，包含已有记忆和新对话
        const basePrompt = `
请分析以下对话内容，提取出重要的用户偏好、习惯、需求和背景信息，这些信息在未来的对话中可能有用。

将每条信息分类并按以下格式返回：
类别: 信息内容

类别应该是以下几种之一：
- 用户偏好：用户喜好、喜欢的事物、风格等
- 技术需求：用户的技术相关需求、开发偏好等
- 个人信息：用户的背景、经历等个人信息
- 交互偏好：用户喜欢的交流方式、沟通风格等
- 其他：不属于以上类别的重要信息

${
  existingMemoriesContent
    ? `以下是已经提取的重要信息：
${existingMemoriesContent}

请分析新的对话内容，提取出新的重要信息，避免重复已有信息。只关注新增的、有价值的信息。`
    : '请确保每条信息都是简洁、准确的。如果没有找到重要信息，请返回空字符串。'
}

新的对话内容:
${newConversation}
`

        // 根据分析深度调整提示词
        const adjustedPrompt = adjustPromptForDepth(basePrompt, analysisDepth)

        // 调用分析函数，传递自定义提示词
        const memories = await analyzeConversation(newConversation, memoryState.analyzeModel!, adjustedPrompt)

        // 用户关注点学习
        if (memoryState.interestTrackingEnabled) {
          const newTopics = extractUserInterests(newConversation)
          if (newTopics.length > 0) {
            console.log(`[Memory Analysis] Extracted user interests: ${newTopics.join(', ')}`)

            // 更新用户关注点
            const now = new Date().toISOString()
            const updatedInterests = [...(memoryState.userInterests || [])]

            // 增加新发现的关注点权重
            newTopics.forEach((topic) => {
              const existingIndex = updatedInterests.findIndex((i) => i.topic === topic)
              if (existingIndex >= 0) {
                // 已存在的关注点，增加权重
                const updatedInterest = {
                  ...updatedInterests[existingIndex],
                  weight: Math.min(1, updatedInterests[existingIndex].weight + 0.1),
                  lastUpdated: now
                }
                store.dispatch(updateUserInterest(updatedInterest))
              } else {
                // 新的关注点
                const newInterest = {
                  topic,
                  weight: 0.5, // 初始权重
                  lastUpdated: now
                }
                store.dispatch(updateUserInterest(newInterest))
              }
            })
          }
        }
        console.log('[Memory Analysis] Analysis complete. Memories extracted:', memories)

        // 添加提取的记忆
        if (memories && memories.length > 0) {
          // 性能监控：记录分析时间
          const endTime = performance.now()
          const analysisTime = endTime - startTime

          // 更新分析统计数据
          store.dispatch(
            updateAnalysisStats({
              totalAnalyses: (memoryState.analysisStats?.totalAnalyses || 0) + 1,
              successfulAnalyses: (memoryState.analysisStats?.successfulAnalyses || 0) + 1,
              newMemoriesGenerated: (memoryState.analysisStats?.newMemoriesGenerated || 0) + memories.length,
              averageAnalysisTime: memoryState.analysisStats?.totalAnalyses
                ? ((memoryState.analysisStats.averageAnalysisTime || 0) *
                    (memoryState.analysisStats.totalAnalyses || 0) +
                    analysisTime) /
                  ((memoryState.analysisStats.totalAnalyses || 0) + 1)
                : analysisTime,
              lastAnalysisTime: Date.now()
            })
          )

          // 性能监控：记录分析延迟
          try {
            store.dispatch(addAnalysisLatency(analysisTime))
          } catch (error) {
            console.warn('[Memory Analysis] Failed to add analysis latency:', error)
          }
          // 智能去重：使用AI模型检查语义相似的记忆
          const existingMemories = store.getState().memory?.memories || []

          // 首先进行简单的字符串匹配去重
          const newMemories = memories.filter((memory) => {
            return !existingMemories.some((m) => m.content === memory.content)
          })

          console.log(`[Memory Analysis] Found ${memories.length} memories, ${newMemories.length} are new`)

          // 添加新记忆
          for (const memory of newMemories) {
            // 获取当前选中的列表ID
            const currentListId = store.getState().memory?.currentListId || store.getState().memory?.memoryLists[0]?.id

            // 收集新分析的消息ID
            const newMessageIds = messages.map((msg) => msg.id)

            // 获取最后一条消息的ID，用于跟踪分析进度
            const lastMessageId = messages[messages.length - 1]?.id

            dispatch(
              addMemory({
                content: memory.content,
                source: '自动分析',
                category: memory.category,
                listId: currentListId,
                analyzedMessageIds: newMessageIds,
                lastMessageId: lastMessageId,
                topicId: targetTopicId
              })
            )
            console.log(
              `[Memory Analysis] Added new memory: "${memory.content}" (${memory.category}) to list ${currentListId}`
            )
          }

          console.log(`[Memory Analysis] Processed ${memories.length} potential memories, added ${newMemories.length}.`)

          // 自适应分析：根据分析结果调整分析频率
          if (memoryState.adaptiveAnalysisEnabled) {
            // 如果分析成功率低，增加分析频率
            const successRate =
              (memoryState.analysisStats?.successfulAnalyses || 0) /
              Math.max(1, memoryState.analysisStats?.totalAnalyses || 1)
            let newFrequency = memoryState.analysisFrequency || 5

            if (successRate < 0.3 && newFrequency > 3) {
              // 成功率低，减少分析频率（增加消息数阈值）
              newFrequency += 1
              console.log(
                `[Memory Analysis] Low success rate (${successRate.toFixed(2)}), increasing message threshold to ${newFrequency}`
              )
            } else if (successRate > 0.7 && newFrequency > 2) {
              // 成功率高，增加分析频率（减少消息数阈值）
              newFrequency -= 1
              console.log(
                `[Memory Analysis] High success rate (${successRate.toFixed(2)}), decreasing message threshold to ${newFrequency}`
              )
            }
          }
        } else {
          console.log('[Memory Analysis] No new memories extracted.')

          // 更新分析统计数据（分析失败）
          const endTime = performance.now()
          const analysisTime = endTime - startTime

          store.dispatch(
            updateAnalysisStats({
              totalAnalyses: (memoryState.analysisStats?.totalAnalyses || 0) + 1,
              lastAnalysisTime: Date.now()
            })
          )

          // 性能监控：记录分析延迟
          try {
            store.dispatch(addAnalysisLatency(analysisTime))
          } catch (error) {
            console.warn('[Memory Analysis] Failed to add analysis latency:', error)
          }
        }

        // 性能监控：更新性能指标
        if (memoryState.monitoringEnabled) {
          try {
            store.dispatch(
              updatePerformanceMetrics({
                memoryCount: store.getState().memory?.memories.length || 0,
                shortMemoryCount: store.getState().memory?.shortMemories.length || 0,
                lastPerformanceCheck: Date.now()
              })
            )
          } catch (error) {
            console.warn('[Memory Analysis] Failed to update performance metrics:', error)
          }
        }
      } catch (error) {
        console.error('Failed to analyze and add memories:', error)
      } finally {
        dispatch(setAnalyzing(false))
        console.log('[Memory Analysis] Analysis finished.')
      }
      // 依赖项只需要 dispatch，因为其他所有状态都在函数内部重新获取
    },
    [dispatch]
  )

  // Ref 来存储最新的 analyzeAndAddMemories 函数
  const analyzeAndAddMemoriesRef = useRef(analyzeAndAddMemories)

  // Effect 来保持 ref 是最新的
  useEffect(() => {
    analyzeAndAddMemoriesRef.current = analyzeAndAddMemories
  }, [analyzeAndAddMemories])



  // 记录记忆访问
  const recordMemoryAccess = useCallback((memoryId: string, isShortMemory: boolean = false) => {
    store.dispatch(accessMemory({ id: memoryId, isShortMemory }))
  }, [])

  // Effect 来设置/清除定时器，只依赖于启动条件
  useEffect(() => {
    // 定期更新记忆优先级
    const priorityUpdateInterval = setInterval(() => {
      const memoryState = store.getState().memory
      if (!memoryState?.priorityManagementEnabled) return

      // 检查上次更新时间，避免频繁更新
      const now = Date.now()
      const lastUpdate = memoryState.lastPriorityUpdate || 0
      const updateInterval = 30 * 60 * 1000 // 30分钟更新一次

      if (now - lastUpdate < updateInterval) return

      console.log('[Memory Priority] Updating memory priorities and freshness...')
      store.dispatch(updateMemoryPriorities())
    }, 10 * 60 * 1000) // 每10分钟检查一次

    return () => {
      clearInterval(priorityUpdateInterval)
    }
  }, [])

  // Effect 来设置/清除分析定时器，只依赖于启动条件
  useEffect(() => {
    if (!isActive || !autoAnalyze || !analyzeModel) {
      console.log('[Memory Analysis Timer] Conditions not met for setting up timer:', {
        isActive,
        autoAnalyze,
        analyzeModel
      })
      return // 清理函数不需要显式返回 undefined
    }

    console.log('[Memory Analysis Timer] Setting up interval timer (1 minute)...') // 更新日志说明时间
    // 设置 1 分钟间隔用于测试
    const intervalId = setInterval(
      () => {
        console.log('[Memory Analysis Timer] Interval triggered. Calling analyze function from ref...')
        // 定时器触发时不指定话题ID，使用当前活动话题
        analyzeAndAddMemoriesRef.current() // 调用 ref 中的函数
      },
      1 * 60 * 1000
    ) // 1 分钟

    // 清理函数
    return () => {
      console.log('[Memory Analysis Timer] Clearing interval timer...')
      clearInterval(intervalId)
    }
    // 依赖项只包含决定是否启动定时器的设置
  }, [isActive, autoAnalyze, analyzeModel])

  // 返回分析函数和记忆访问函数，以便在其他组件中使用
  return { analyzeAndAddMemories, recordMemoryAccess }
}

// 手动添加短记忆
export const addShortMemoryItem = (
  content: string,
  topicId: string,
  analyzedMessageIds?: string[],
  lastMessageId?: string
) => {
  // Use imported store directly
  store.dispatch(
    addShortMemory({
      content,
      topicId,
      analyzedMessageIds,
      lastMessageId
    })
  )
}

// 分析对话内容并提取重要信息添加到短期记忆
// 分析对话内容并提取重要信息添加到短期记忆
export const analyzeAndAddShortMemories = async (topicId: string) => {
  if (!topicId) {
    console.log('[Short Memory Analysis] No topic ID provided')
    return false
  }

  // 获取当前记忆状态
  const memoryState = store.getState().memory || {}
  const messagesState = store.getState().messages || {}
  const shortMemoryAnalyzeModel = memoryState.shortMemoryAnalyzeModel

  if (!shortMemoryAnalyzeModel) {
    console.log('[Short Memory Analysis] No short memory analyze model set')
    return false
  }

  // 获取对话内容
  let messages: any[] = []

  // 从 Redux store 中获取话题消息
  if (messagesState.messagesByTopic && messagesState.messagesByTopic[topicId]) {
    messages = messagesState.messagesByTopic[topicId] || []
  } else {
    // 如果 Redux store 中没有，则从数据库中获取
    try {
      const topicMessages = await TopicManager.getTopicMessages(topicId)
      if (topicMessages && topicMessages.length > 0) {
        messages = topicMessages
      }
    } catch (error) {
      console.error(`[Short Memory Analysis] Failed to get messages for topic ${topicId}:`, error)
      return false
    }
  }

  if (!messages || messages.length === 0) {
    console.log('[Short Memory Analysis] No messages to analyze.')
    return false
  }

  // 获取现有的短期记忆
  const existingShortMemories = store.getState().memory?.shortMemories || []
  const topicShortMemories = existingShortMemories.filter((memory) => memory.topicId === topicId)

  // 收集所有已分析过的消息ID
  const analyzedMessageIds = new Set<string>()
  topicShortMemories.forEach((memory) => {
    if (memory.analyzedMessageIds) {
      memory.analyzedMessageIds.forEach((id) => analyzedMessageIds.add(id))
    }
  })

  // 找出未分析过的新消息
  const newMessages = messages.filter((msg) => !analyzedMessageIds.has(msg.id))

  if (newMessages.length === 0) {
    console.log('[Short Memory Analysis] No new messages to analyze.')
    return false
  }

  console.log(`[Short Memory Analysis] Found ${newMessages.length} new messages to analyze.`)

  // 构建新消息的对话内容
  const newConversation = newMessages.map((msg) => `${msg.role || 'user'}: ${msg.content || ''}`).join('\n')

  // 获取已有的短期记忆内容
  const existingMemoriesContent = topicShortMemories.map((memory) => memory.content).join('\n')

  try {
    console.log('[Short Memory Analysis] Starting analysis...')
    console.log(`[Short Memory Analysis] Analyzing topic: ${topicId}`)
    console.log('[Short Memory Analysis] New conversation length:', newConversation.length)

    // 构建短期记忆分析提示词，包含已有记忆和新对话
    const prompt = `
请对以下对话内容进行详细分析和总结，提取对当前对话至关重要的上下文信息。

分析要求：
1. 详细总结用户的每一句话中表达的关键信息、需求和意图
2. 分析AI回复中的重要内容和对用户问题的解决方案
3. 识别对话中的重要事实、数据和具体细节
4. 捕捉对话的逻辑发展和转折点
5. 提取对理解当前对话上下文必不可少的信息

与长期记忆不同，短期记忆应该关注当前对话的具体细节和上下文，而不是用户的长期偏好。每条短期记忆应该是对对话片段的精准总结，确保不遗漏任何重要信息。

${
  existingMemoriesContent
    ? `以下是已经提取的重要信息：
${existingMemoriesContent}

请分析新的对话内容，提取出新的重要信息，避免重复已有信息。确保新提取的信息与已有信息形成连贯的上下文理解。`
    : '请对对话进行全面分析，确保不遗漏任何重要细节。每条总结应该是完整的句子，清晰表达一个重要的上下文信息。'
}

输出格式：
- 提供完整的上下文总结，数量不限，确保覆盖所有重要信息
- 每条总结应该是一个完整的句子
- 确保总结内容精准、具体且与当前对话直接相关
- 按重要性排序，最重要的信息放在前面
- 对于复杂的对话，应提供足够多的条目（至少5-10条）以确保上下文的完整性
- 如果对话内容简单，可以少于5条，但必须确保完整捕捉所有重要信息

如果没有找到新的重要信息，请返回空字符串。

新的对话内容:
${newConversation}
`

    // 获取模型
    const model = store
      .getState()
      .llm.providers.flatMap((provider) => provider.models)
      .find((model) => model.id === shortMemoryAnalyzeModel)

    if (!model) {
      console.error(`[Short Memory Analysis] Model ${shortMemoryAnalyzeModel} not found`)
      return false
    }

    // 调用AI生成文本
    console.log('[Short Memory Analysis] Calling AI.generateText...')
    const result = await fetchGenerate({
      prompt: prompt,
      content: newConversation,
      modelId: shortMemoryAnalyzeModel
    })
    console.log('[Short Memory Analysis] AI.generateText response:', result)

    if (!result || typeof result !== 'string' || result.trim() === '') {
      console.log('[Short Memory Analysis] No valid result from AI analysis.')
      return false
    }

    // 改进的记忆提取逻辑
    let extractedLines: string[] = []

    // 首先尝试匹配带有数字或短横线的列表项
    const listItemRegex = /(?:^|\n)(?:\d+\.\s*|\-\s*)(.+?)(?=\n\d+\.\s*|\n\-\s*|\n\n|$)/gs
    let match
    while ((match = listItemRegex.exec(result)) !== null) {
      if (match[1] && match[1].trim()) {
        extractedLines.push(match[1].trim())
      }
    }

    // 如果没有找到列表项，则尝试按行分割并过滤
    if (extractedLines.length === 0) {
      extractedLines = result
        .split('\n')
        .map(line => line.trim())
        .filter(line => {
          // 过滤掉空行和非内容行（如标题、分隔符等）
          return line &&
                 !line.startsWith('#') &&
                 !line.startsWith('---') &&
                 !line.startsWith('===') &&
                 !line.includes('没有找到新的重要信息') &&
                 !line.includes('No new important information')
        })
        // 清理行首的数字、点和短横线
        .map(line => line.replace(/^(\d+\.\s*|\-\s*)/, '').trim())
    }

    console.log('[Short Memory Analysis] Extracted items:', extractedLines)

    if (extractedLines.length === 0) {
      console.log('[Short Memory Analysis] No memory items extracted from the analysis result.')
      return false
    }

    // 过滤掉已存在的记忆（使用更严格的比较）
    const existingContents = topicShortMemories.map((memory) => memory.content.toLowerCase())
    const newMemories = extractedLines.filter((content: string) => {
      const normalizedContent = content.toLowerCase()
      // 检查是否与现有记忆完全匹配或高度相似
      return !existingContents.some(existingContent =>
        existingContent === normalizedContent ||
        // 简单的相似度检查 - 如果一个字符串包含另一个的80%以上的内容
        (existingContent.includes(normalizedContent) && normalizedContent.length > existingContent.length * 0.8) ||
        (normalizedContent.includes(existingContent) && existingContent.length > normalizedContent.length * 0.8)
      )
    })

    console.log(`[Short Memory Analysis] Found ${extractedLines.length} items, ${newMemories.length} are new`)

    if (newMemories.length === 0) {
      console.log('[Short Memory Analysis] No new memories to add after filtering.')
      return false
    }

    // 收集新分析的消息ID
    const newMessageIds = newMessages.map((msg) => msg.id)

    // 获取最后一条消息的ID，用于跟踪分析进度
    const lastMessageId = messages[messages.length - 1]?.id

    // 添加新的短期记忆
    const addedMemories: string[] = [] // Explicitly type addedMemories
    for (const content of newMemories) {
      try {
        store.dispatch(
          addShortMemory({
            content,
            topicId,
            analyzedMessageIds: newMessageIds,
            lastMessageId: lastMessageId
          })
        )
        addedMemories.push(content)
        console.log(`[Short Memory Analysis] Added new short memory: "${content}" to topic ${topicId}`)
      } catch (error) {
        console.error(`[Short Memory Analysis] Failed to add memory: "${content}"`, error)
      }
    }

    // 显式触发保存操作，确保数据被持久化
    try {
      const state = store.getState().memory
      await store.dispatch(saveMemoryData({
        memoryLists: state.memoryLists,
        memories: state.memories,
        shortMemories: state.shortMemories
      })).unwrap() // 使用unwrap()来等待异步操作完成并处理错误
      console.log('[Short Memory Analysis] Memory data saved successfully')
    } catch (error) {
      console.error('[Short Memory Analysis] Failed to save memory data:', error)
      // 即使保存失败，我们仍然返回true，因为记忆已经添加到Redux状态中
    }

    return addedMemories.length > 0
  } catch (error) {
    console.error('[Short Memory Analysis] Failed to analyze and add short memories:', error)
    return false
  }
}

// 将记忆应用到系统提示词
import { persistor } from '@renderer/store' // Import persistor

export const applyMemoriesToPrompt = (systemPrompt: string): string => {
  // 检查持久化状态是否已加载完成
  if (!persistor.getState().bootstrapped) {
    console.warn('[Memory] Persistor not bootstrapped yet. Skipping applying memories.')
    return systemPrompt
  }

  const state = store.getState() // Use imported store
  // 确保 state.memory 存在，如果不存在则提供默认值
  const { isActive, memories, memoryLists, shortMemoryActive, shortMemories, priorityManagementEnabled } = state.memory || {
    isActive: false,
    memories: [],
    memoryLists: [],
    shortMemoryActive: false,
    shortMemories: [],
    priorityManagementEnabled: false
  }

  // 获取当前话题ID
  const currentTopicId = state.messages.currentTopic?.id

  console.log('[Memory] Applying memories to prompt:', {
    isActive,
    memoriesCount: memories?.length,
    listsCount: memoryLists?.length,
    shortMemoryActive,
    shortMemoriesCount: shortMemories?.length,
    currentTopicId,
    priorityManagementEnabled
  })

  let result = systemPrompt
  let hasContent = false

  // 处理短记忆
  if (shortMemoryActive && shortMemories && shortMemories.length > 0 && currentTopicId) {
    // 获取当前话题的短记忆
    let topicShortMemories = shortMemories.filter((memory) => memory.topicId === currentTopicId)

    // 如果启用了智能优先级管理，根据优先级排序
    if (priorityManagementEnabled && topicShortMemories.length > 0) {
      // 计算每个记忆的综合分数（重要性 * 衰减因子 * 鲜度）
      const scoredMemories = topicShortMemories.map(memory => {
        // 记录访问
        store.dispatch(accessMemory({ id: memory.id, isShortMemory: true }))

        // 计算综合分数
        const importance = memory.importance || 0.5
        const decayFactor = memory.decayFactor || 1
        const freshness = memory.freshness || 0.5
        const score = importance * decayFactor * (freshness * 2) // 短期记忆更注重鲜度
        return { memory, score }
      })

      // 按综合分数降序排序
      scoredMemories.sort((a, b) => b.score - a.score)

      // 提取排序后的记忆
      topicShortMemories = scoredMemories.map(item => item.memory)

      // 限制数量，避免提示词过长
      if (topicShortMemories.length > 10) {
        topicShortMemories = topicShortMemories.slice(0, 10)
      }
    }

    if (topicShortMemories.length > 0) {
      const shortMemoryPrompt = topicShortMemories.map((memory) => `- ${memory.content}`).join('\n')
      console.log('[Memory] Short memory prompt:', shortMemoryPrompt)

      // 添加短记忆到提示词
      result = `${result}\n\n当前对话的短期记忆(非常重要):\n${shortMemoryPrompt}`
      hasContent = true
    }
  }

  // 处理长记忆
  if (isActive && memories && memories.length > 0 && memoryLists && memoryLists.length > 0) {
    // 获取所有激活的记忆列表
    const activeListIds = memoryLists.filter((list) => list.isActive).map((list) => list.id)

    if (activeListIds.length > 0) {
      // 只获取激活列表中的记忆
      let activeMemories = memories.filter((memory) => activeListIds.includes(memory.listId))

      // 如果启用了智能优先级管理，根据优先级排序
      if (priorityManagementEnabled && activeMemories.length > 0) {
        // 计算每个记忆的综合分数
        const scoredMemories = activeMemories.map(memory => {
          // 记录访问
          store.dispatch(accessMemory({ id: memory.id }))

          // 计算综合分数
          const importance = memory.importance || 0.5
          const decayFactor = memory.decayFactor || 1
          const freshness = memory.freshness || 0.5
          const score = importance * decayFactor * freshness
          return { memory, score }
        })

        // 按综合分数降序排序
        scoredMemories.sort((a, b) => b.score - a.score)

        // 限制每个列表的记忆数量
        const maxMemoriesPerList = 5
        const memoriesByList: Record<string, Memory[]> = {}

        // 提取排序后的记忆
        const sortedMemories = scoredMemories.map(item => item.memory)

        sortedMemories.forEach(memory => {
          if (!memoriesByList[memory.listId]) {
            memoriesByList[memory.listId] = []
          }
          if (memoriesByList[memory.listId].length < maxMemoriesPerList) {
            memoriesByList[memory.listId].push(memory)
          }
        })

        // 重新构建活跃记忆列表
        activeMemories = Object.values(memoriesByList).flat() as Memory[]
      }

      if (activeMemories.length > 0) {
        // 按列表分组构建记忆提示词
        let memoryPrompt = ''

        // 如果只有一个激活列表，直接列出记忆
        if (activeListIds.length === 1) {
          memoryPrompt = activeMemories.map((memory) => `- ${memory.content}`).join('\n')
        } else {
          // 如果有多个激活列表，按列表分组
          for (const listId of activeListIds) {
            const list = memoryLists.find((l) => l.id === listId)
            if (list) {
              const listMemories = activeMemories.filter((m) => m.listId === listId)
              if (listMemories.length > 0) {
                memoryPrompt += `\n${list.name}:\n`
                memoryPrompt += listMemories.map((memory) => `- ${memory.content}`).join('\n')
                memoryPrompt += '\n'
              }
            }
          }
        }

        console.log('[Memory] Long-term memory prompt:', memoryPrompt)

        // 添加到系统提示词
        result = `${result}\n\n用户的长期记忆:\n${memoryPrompt}`
        hasContent = true
      }
    }
  }

  if (hasContent) {
    console.log('[Memory] Final prompt with memories applied')
  } else {
    console.log('[Memory] No memories to apply')
  }

  return result
}
