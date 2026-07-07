import type { Topic } from '@renderer/types'
import type { Topic as SharedTopic } from '@shared/data/types/topic'

import { buildBranchSystemPrompt } from './buildBranchSystemPrompt'

export interface BranchPromptAnchor {
  selectedText: string
}

export type FetchedBranchTopic = Pick<SharedTopic, 'id' | 'name' | 'createdAt' | 'updatedAt'> & {
  assistantId?: string | null
  isNameManuallyEdited?: boolean
}

export interface BuildReopenedBranchSystemPromptArgs {
  anchor: BranchPromptAnchor
  mainGoal?: string
}

export function buildReopenedBranchSystemPrompt(args: BuildReopenedBranchSystemPromptArgs): string {
  return buildBranchSystemPrompt({
    selectedText: args.anchor.selectedText,
    mainGoal: args.mainGoal
  })
}

export interface PrepareBranchTopicForRenderArgs {
  topic: FetchedBranchTopic
  anchor: BranchPromptAnchor
  mainGoal?: string
  assistantIdFallback: string
}

export function prepareBranchTopicForRender(args: PrepareBranchTopicForRenderArgs): Topic {
  const { topic, anchor, mainGoal, assistantIdFallback } = args

  return {
    id: topic.id,
    assistantId: topic.assistantId ?? assistantIdFallback,
    name: topic.name,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
    messages: [],
    prompt: buildReopenedBranchSystemPrompt({ anchor, mainGoal }),
    isNameManuallyEdited: topic.isNameManuallyEdited
  }
}
