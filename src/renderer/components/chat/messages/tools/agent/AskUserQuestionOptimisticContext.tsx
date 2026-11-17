import { createContext, use } from 'react'

import type { AskUserQuestionToolInput } from '../shared/agentToolTypes'

export type AskUserQuestionOptimisticInputs = Record<string, AskUserQuestionToolInput>

const AskUserQuestionOptimisticInputContext = createContext<AskUserQuestionOptimisticInputs>({})

export const AskUserQuestionOptimisticInputProvider = AskUserQuestionOptimisticInputContext.Provider

export function useAskUserQuestionOptimisticInput(toolCallId?: string): AskUserQuestionToolInput | undefined {
  const inputs = use(AskUserQuestionOptimisticInputContext)
  if (!toolCallId) return undefined
  return inputs[toolCallId]
}
