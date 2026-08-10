import { loggerService } from '@logger'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('usePromptProcessor')

interface PromptProcessor {
  prompt: string
  modelName?: string
}

export function usePromptProcessor({ prompt, modelName }: PromptProcessor): string {
  const [processedPrompt, setProcessedPrompt] = useState({ modelName, prompt, value: prompt })

  useEffect(() => {
    let cancelled = false

    const setCurrentProcessedPrompt = (value: string) => {
      if (!cancelled) {
        setProcessedPrompt({ modelName, prompt, value })
      }
    }

    const processPrompt = async () => {
      try {
        if (containsSupportedVariables(prompt)) {
          const result = await replacePromptVariables(prompt, modelName)
          setCurrentProcessedPrompt(result)
        } else {
          setCurrentProcessedPrompt(prompt)
        }
      } catch (error) {
        logger.error('Failed to process prompt variables, falling back:', error as Error)
        setCurrentProcessedPrompt(prompt)
      }
    }

    void processPrompt()

    return () => {
      cancelled = true
    }
  }, [prompt, modelName])

  return processedPrompt.prompt === prompt && processedPrompt.modelName === modelName ? processedPrompt.value : prompt
}
