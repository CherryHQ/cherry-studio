import { containsSupportedVariables, promptVariableReplacer } from '@renderer/utils/prompt'
import { useEffect, useState } from 'react'

import { useSettings } from './useSettings'

interface PromptProcessor {
  prompt: string
  modelName?: string
}

export function usePromptProcessor({ prompt, modelName }: PromptProcessor): string {
  const { promptAutoRefresh, promptRefreshInterval, promptShowVariableReplacement } = useSettings()
  const [processedPrompt, setProcessedPrompt] = useState('')

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null

    const processPrompt = async () => {
      try {
        if (prompt && promptShowVariableReplacement && containsSupportedVariables(prompt)) {
          const result = await promptVariableReplacer(prompt, modelName)
          setProcessedPrompt(result)
        } else {
          setProcessedPrompt(prompt)
        }
      } catch (error) {
        console.error('Error processing prompt variables:', error)
        setProcessedPrompt(prompt)
      }
    }

    // 立刻执行
    processPrompt()

    // 设置自动刷新
    if (promptAutoRefresh && promptRefreshInterval > 0 && containsSupportedVariables(prompt)) {
      intervalId = setInterval(processPrompt, promptRefreshInterval * 1000)
    }

    // 清理，确保在跳转到其他组件时清理该定时器
    return () => {
      if (intervalId !== null) {
        clearInterval(intervalId)
      }
    }
  }, [prompt, promptAutoRefresh, promptRefreshInterval, promptShowVariableReplacement, modelName])

  return processedPrompt
}
