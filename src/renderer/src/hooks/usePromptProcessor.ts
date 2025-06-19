import { containsSupportedVariables, promptVariableReplacer } from '@renderer/utils/prompt'
import { useEffect, useState } from 'react'

interface PromptProcessor {
  prompt: string
  modelName?: string
}

export function usePromptProcessor({ prompt, modelName }: PromptProcessor): string {
  const [processedPrompt, setProcessedPrompt] = useState('')

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
        console.error('Error processing prompt variables:', error)
        setProcessedPrompt(prompt)
      }
    }

    processPrompt()
  }, [prompt, modelName])

  return processedPrompt
}
