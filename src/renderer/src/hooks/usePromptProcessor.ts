import Logger from '@renderer/config/logger'
import { containsSupportedVariables, promptVariableReplacer } from '@renderer/utils/prompt'
import { useEffect, useState } from 'react'

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
          const result = await promptVariableReplacer(prompt, modelName)
          setProcessedPrompt(result)
        } else {
          setProcessedPrompt(prompt)
        }
      } catch (error) {
        Logger.error('Failed to process prompt variables, falling back:', error)
        setProcessedPrompt(prompt)
      }
    }

    processPrompt()
  }, [prompt, modelName])

  return processedPrompt
}
