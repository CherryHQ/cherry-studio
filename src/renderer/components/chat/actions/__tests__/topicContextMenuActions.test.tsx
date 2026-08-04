import type { Topic } from '@renderer/types/topic'
import { describe, expect, it, vi } from 'vitest'

import { executeTopicMenuAction, resolveTopicMenuActions, type TopicActionContext } from '../topicContextMenuActions'

const t = ((key: string) => key) as TopicActionContext['t']

const exportMenuOptions: TopicActionContext['exportMenuOptions'] = {
  docx: true,
  image: true,
  joplin: true,
  markdown: true,
  markdown_reason: true,
  notes: true,
  notion: true,
  obsidian: true,
  plain_text: true,
  siyuan: true,
  yuque: true
}

const topic: Topic = {
  id: 'topic-a',
  assistantId: 'assistant-a',
  name: 'Topic A',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
}

function createTopicActionFixture(overrides: Partial<TopicActionContext> = {}): TopicActionContext {
  return {
    assistantMoveTargets: [],
    exportMenuOptions,
    isActiveInCurrentTab: false,
    isRenaming: false,
    onAutoRename: vi.fn(),
    onClearMessages: vi.fn(),
    onCopyImage: vi.fn(),
    onCopyMarkdown: vi.fn(),
    onCopyPlainText: vi.fn(),
    onDelete: vi.fn(),
    onExportImage: vi.fn(),
    onExportJoplin: vi.fn(),
    onExportMarkdown: vi.fn(),
    onExportMarkdownReason: vi.fn(),
    onExportNotion: vi.fn(),
    onExportObsidian: vi.fn(),
    onExportSiyuan: vi.fn(),
    onExportWord: vi.fn(),
    onExportYuque: vi.fn(),
    onPinTopic: vi.fn(),
    onSaveToKnowledge: vi.fn(),
    onSaveToNotes: vi.fn(),
    onStartRename: vi.fn(),
    t,
    topic,
    topicsLength: 2,
    ...overrides
  }
}

describe('topic context menu actions', () => {
  it('respects export menu preferences for notes and copy actions', () => {
    const actions = resolveTopicMenuActions(
      createTopicActionFixture({
        exportMenuOptions: {
          ...exportMenuOptions,
          image: false,
          notes: false,
          plain_text: false
        }
      })
    )

    expect(actions.map((action) => action.id)).not.toContain('topic.save-notes')

    const copyAction = actions.find((action) => action.id === 'topic.copy')
    expect(copyAction?.children.map((action) => action.id)).toEqual(['topic.copy.markdown'])

    const exportAction = actions.find((action) => action.id === 'topic.export')
    expect(exportAction?.children.map((action) => action.id)).not.toContain('topic.export.image')
  })

  it('runs a move-to-assistant submenu action', async () => {
    const onMoveToAssistant = vi.fn()
    const context = createTopicActionFixture({
      assistantMoveTargets: [{ id: 'assistant-b', name: 'Assistant B' }],
      onMoveToAssistant
    })

    const actions = resolveTopicMenuActions(context)
    const moveAction = actions.find((action) => action.id === 'topic.move-to-assistant')

    expect(moveAction?.label).toBe('chat.topics.move_to')
    expect(moveAction?.children.map((action) => action.label)).toEqual(['Assistant B'])

    await executeTopicMenuAction(moveAction!.children[0], context)

    expect(onMoveToAssistant).toHaveBeenCalledWith(topic, 'assistant-b')
  })

  it('does not run a stale move-to-assistant submenu action', async () => {
    const onMoveToAssistant = vi.fn()
    const context = createTopicActionFixture({
      assistantMoveTargets: [{ id: 'assistant-b', name: 'Assistant B' }],
      onMoveToAssistant
    })
    const moveAction = resolveTopicMenuActions(context).find((action) => action.id === 'topic.move-to-assistant')
    const staleAction = moveAction!.children[0]

    const currentContext = createTopicActionFixture({
      assistantMoveTargets: [{ id: 'assistant-c', name: 'Assistant C' }],
      onMoveToAssistant
    })

    await expect(executeTopicMenuAction(staleAction, currentContext)).resolves.toBe(false)
    expect(onMoveToAssistant).not.toHaveBeenCalled()
  })

  it('does not run a move-to-assistant submenu action for the current assistant', async () => {
    const onMoveToAssistant = vi.fn()
    const context = createTopicActionFixture({
      assistantMoveTargets: [{ id: 'assistant-a', name: 'Assistant A' }],
      onMoveToAssistant
    })
    const moveAction = resolveTopicMenuActions(context).find((action) => action.id === 'topic.move-to-assistant')

    await expect(executeTopicMenuAction(moveAction!.children[0], context)).resolves.toBe(false)
    expect(onMoveToAssistant).not.toHaveBeenCalled()
  })
})
