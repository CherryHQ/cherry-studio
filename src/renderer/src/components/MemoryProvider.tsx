import { useMemoryService } from '@renderer/services/MemoryService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import store from '@renderer/store'
import { clearShortMemories, loadMemoryData } from '@renderer/store/memory'
import { FC, ReactNode, useEffect, useRef } from 'react'

interface MemoryProviderProps {
  children: ReactNode
}

/**
 * 记忆功能提供者组件
 * 这个组件负责初始化记忆功能并在适当的时候触发记忆分析
 */
const MemoryProvider: FC<MemoryProviderProps> = ({ children }) => {
  console.log('[MemoryProvider] Initializing memory provider')
  const { analyzeAndAddMemories } = useMemoryService()
  const dispatch = useAppDispatch()

  // 从 Redux 获取记忆状态
  const isActive = useAppSelector((state) => state.memory?.isActive || false)
  const autoAnalyze = useAppSelector((state) => state.memory?.autoAnalyze || false)
  const analyzeModel = useAppSelector((state) => state.memory?.analyzeModel || null)
  const shortMemoryActive = useAppSelector((state) => state.memory?.shortMemoryActive || false)

  // 获取当前对话
  const currentTopic = useAppSelector((state) => state.messages?.currentTopic?.id)
  const messages = useAppSelector((state) => {
    if (!currentTopic || !state.messages?.messagesByTopic) {
      return []
    }
    return state.messages.messagesByTopic[currentTopic] || []
  })

  // 存储上一次的话题ID
  const previousTopicRef = useRef<string | null>(null)

  // 添加一个 ref 来存储上次分析时的消息数量
  const lastAnalyzedCountRef = useRef(0)

  // 在组件挂载时加载记忆数据
  useEffect(() => {
    console.log('[MemoryProvider] Loading memory data from file')
    dispatch(loadMemoryData())
  }, [])

  // 当对话更新时，触发记忆分析
  useEffect(() => {
    if (isActive && autoAnalyze && analyzeModel && messages.length > 0) {
      // 获取当前的分析频率
      const memoryState = store.getState().memory || {}
      const analysisFrequency = memoryState.analysisFrequency || 5
      const adaptiveAnalysisEnabled = memoryState.adaptiveAnalysisEnabled || false

      // 检查是否有新消息需要分析
      const newMessagesCount = messages.length - lastAnalyzedCountRef.current

      // 使用自适应分析频率
      if (
        newMessagesCount >= analysisFrequency ||
        (messages.length % analysisFrequency === 0 && lastAnalyzedCountRef.current === 0)
      ) {
        console.log(
          `[Memory Analysis] Triggering analysis with ${newMessagesCount} new messages (frequency: ${analysisFrequency})`
        )

        // 将当前话题ID传递给分析函数
        analyzeAndAddMemories(currentTopic)
        lastAnalyzedCountRef.current = messages.length

        // 性能监控：记录当前分析触发时的消息数量
        if (adaptiveAnalysisEnabled) {
          console.log(`[Memory Analysis] Adaptive analysis enabled, current frequency: ${analysisFrequency}`)
        }
      }
    }
  }, [isActive, autoAnalyze, analyzeModel, messages.length, analyzeAndAddMemories, currentTopic])

  // 当对话话题切换时，清除上一个话题的短记忆
  useEffect(() => {
    // 如果短记忆功能激活且当前话题发生变化
    if (shortMemoryActive && currentTopic !== previousTopicRef.current && previousTopicRef.current) {
      console.log(`[Memory] Topic changed from ${previousTopicRef.current} to ${currentTopic}, clearing short memories`)
      // 清除上一个话题的短记忆
      dispatch(clearShortMemories(previousTopicRef.current))
    }

    // 更新上一次的话题ID
    previousTopicRef.current = currentTopic || null
  }, [currentTopic, shortMemoryActive, dispatch])

  return <>{children}</>
}

export default MemoryProvider
