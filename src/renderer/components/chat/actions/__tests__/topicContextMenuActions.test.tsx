import type { Topic } from '@renderer/types/topic'
import { describe, expect, it, vi } from 'vitest'

import { resolveTopicMenuActions, type TopicActionContext } from '../topicContextMenuActions'

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
})
