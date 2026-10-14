import { createContext, use } from 'react'

export type AskUserQuestionOptimisticInputs = Record<string, unknown>

const AskUserQuestionOptimisticInputContext = createContext<AskUserQuestionOptimisticInputs>({})

export const AskUserQuestionOptimisticInputProvider = AskUserQuestionOptimisticInputContext.Provider

export function useAskUserQuestionOptimisticInput(toolCallId?: string): unknown {
  const inputs = use(AskUserQuestionOptimisticInputContext)
  if (!toolCallId) return undefined
  return inputs[toolCallId]
}
