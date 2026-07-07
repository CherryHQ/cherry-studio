import { describe, expect, it } from 'vitest'

import { buildBranchSystemPrompt } from '../buildBranchSystemPrompt'
import {
  type BranchPromptAnchor,
  buildReopenedBranchSystemPrompt,
  prepareBranchTopicForRender
} from '../prepareBranchTopicForRender'

const fetchedTopic = {
  id: 'topic-branch-1',
  assistantId: 'asst-1',
  name: 'Branch topic',
  createdAt: '2026-07-07T00:00:00.000Z',
  updatedAt: '2026-07-07T00:01:00.000Z',
  isNameManuallyEdited: false
}

describe('prepareBranchTopicForRender', () => {
  it('reconstructs the same branch prompt shape used by live branch forks', () => {
    const anchor = { selectedText: 'distillation transfers behavior to a smaller model' }
    const mainGoal = 'how can I deploy this model on mobile?'

    const topic = prepareBranchTopicForRender({
      topic: fetchedTopic,
      anchor,
      mainGoal,
      assistantIdFallback: 'asst-fallback'
    })

    expect(topic.prompt).toBe(buildBranchSystemPrompt({ selectedText: anchor.selectedText, mainGoal }))
    expect(topic.prompt).toContain(anchor.selectedText)
    expect(topic.prompt).toContain(mainGoal)
    expect(topic.messages).toEqual([])
  })

  it('uses the assistant fallback for unbound branch topics, matching live fork behavior', () => {
    const topic = prepareBranchTopicForRender({
      topic: { ...fetchedTopic, assistantId: null },
      anchor: { selectedText: 'selected text' },
      assistantIdFallback: 'default'
    })

    expect(topic.assistantId).toBe('default')
  })

  it('omits main-goal section when reopened branch has no parent main goal', () => {
    const prompt = buildReopenedBranchSystemPrompt({
      anchor: { selectedText: 'selected text' },
      mainGoal: undefined
    })

    expect(prompt).not.toContain('【主对话的总目标')
    expect(prompt).toContain('【用户在助手回复中选中的内容】')
    expect(prompt).toContain('selected text')
  })

  it('does not read or include persisted summaries', () => {
    const anchor = {
      selectedText: 'selected text',
      get summary(): string {
        throw new Error('summary should not be read')
      }
    } as BranchPromptAnchor & { summary: string }

    const topic = prepareBranchTopicForRender({
      topic: fetchedTopic,
      anchor,
      mainGoal: 'main goal',
      assistantIdFallback: 'asst-fallback'
    })

    expect(topic.prompt).toContain('selected text')
    expect(topic.prompt).not.toContain('summary')
  })
})
