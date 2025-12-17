import { loggerService } from '@logger'
import { containsSupportedVariables, replacePromptVariables } from '@renderer/utils/prompt'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('usePromptProcessor')

interface PromptProcessor {
  prompt: string
  modelName?: string
}

export function usePromptProcessor({ prompt, modelName }: PromptProcessor): string {
  const [processedPrompt, setProcessedPrompt] = useState(prompt)

  useEffect(() => {
    const processPrompt = async () => {
      try {
        if (containsSupportedVariables(prompt)) {
          const result = await replacePromptVariables(prompt, modelName)
          setProcessedPrompt(result)
        } else {
          setProcessedPrompt(prompt)
        }
      } catch (error) {
        logger.error('Failed to process prompt variables, falling back:', error as Error)
        setProcessedPrompt(prompt)
      }
    }

    processPrompt()
  }, [prompt, modelName])

  return processedPrompt
}
