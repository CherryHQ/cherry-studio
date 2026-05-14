import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import ObsidianExportPopup from '@renderer/components/Popups/ObsidianExportPopup'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import { getTopicMessages } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import { copyTopicAsMarkdown, copyTopicAsPlainText } from '@renderer/utils/copy'
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  exportTopicAsMarkdown,
  exportTopicToNotes,
  exportTopicToNotion,
  topicToMarkdown
} from '@renderer/utils/export'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import type { TFunction } from 'i18next'
import { useCallback, useMemo } from 'react'

import {
  executeTopicMenuAction,
  resolveTopicMenuActions,
  type TopicActionContext,
  type TopicExportMenuOptions
} from './topicContextMenuActions'

type TopicMenuHandler = (topic: Topic) => void | Promise<void>

export interface TopicMenuActionOptions {
  exportMenuOptions: TopicExportMenuOptions
  isRenaming: boolean
  notesPath: string
  onAutoRename: TopicMenuHandler
  onClearMessages: TopicMenuHandler
  onDelete: TopicMenuHandler
  onPinTopic: TopicMenuHandler
  onPromptRename: TopicMenuHandler
  t: TFunction
  topic: Topic
  topicsLength: number
}

export function createTopicActionContext({
  exportMenuOptions,
  isRenaming,
  notesPath,
  onAutoRename,
  onClearMessages,
  onDelete,
  onPinTopic,
  onPromptRename,
  t,
  topic,
  topicsLength
}: TopicMenuActionOptions): TopicActionContext {
  return {
    exportMenuOptions,
    isRenaming,
    onAutoRename,
    onClearMessages,
    onCopyImage: (topic) => void EventEmitter.emit(EVENT_NAMES.COPY_TOPIC_IMAGE, topic),
    onCopyMarkdown: copyTopicAsMarkdown,
    onCopyPlainText: copyTopicAsPlainText,
    onDelete,
    onExportImage: (topic) => void EventEmitter.emit(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic),
    onExportJoplin: async (topic) => {
      const topicMessages = await getTopicMessages(topic.id)
      void exportMarkdownToJoplin(topic.name, topicMessages)
    },
    onExportMarkdown: exportTopicAsMarkdown,
    onExportMarkdownReason: (topic) => exportTopicAsMarkdown(topic, true),
    onExportNotion: (topic) => {
      void exportTopicToNotion(topic)
    },
    onExportObsidian: (topic) => {
      void ObsidianExportPopup.show({ title: topic.name, topic, processingMethod: '3' })
    },
    onExportSiyuan: async (topic) => {
      const markdown = await topicToMarkdown(topic)
      void exportMarkdownToSiyuan(topic.name, markdown)
    },
    onExportWord: async (topic) => {
      const markdown = await topicToMarkdown(topic)
      void window.api.export.toWord(markdown, removeSpecialCharactersForFileName(topic.name))
    },
    onExportYuque: async (topic) => {
      const markdown = await topicToMarkdown(topic)
      void exportMarkdownToYuque(topic.name, markdown)
    },
    onPinTopic,
    onPromptRename,
    onSaveToKnowledge: async (topic) => {
      try {
        const result = await SaveToKnowledgePopup.showForTopic(topic)
        if (result?.success) {
          window.toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
        }
      } catch {
        window.toast.error(t('chat.save.topic.knowledge.error.save_failed'))
      }
    },
    onSaveToNotes: (topic) => exportTopicToNotes(topic, notesPath),
    t,
    topic,
    topicsLength
  }
}

export function getTopicMenuActions(actionContext: TopicActionContext) {
  return resolveTopicMenuActions(actionContext)
}

export async function runTopicMenuAction(
  action: ResolvedAction<TopicActionContext>,
  actionContext: TopicActionContext
) {
  await executeTopicMenuAction(action, actionContext)
}

export interface TopicMenuPreset<TItem> {
  getActions: (item: TItem) => readonly ResolvedAction[]
  onAction: (item: TItem, action: ResolvedAction) => void | Promise<void>
}

export function useTopicMenuPreset<TItem>({
  getActionContext
}: {
  getActionContext: (item: TItem) => TopicActionContext
}): TopicMenuPreset<TItem> {
  const getActions = useCallback(
    (item: TItem) => getTopicMenuActions(getActionContext(item)) as ResolvedAction[],
    [getActionContext]
  )
  const onAction = useCallback(
    async (item: TItem, action: ResolvedAction) => {
      await runTopicMenuAction(action as ResolvedAction<TopicActionContext>, getActionContext(item))
    },
    [getActionContext]
  )

  return useMemo(() => ({ getActions, onAction }), [getActions, onAction])
}

export function useTopicMenuActions(options: TopicMenuActionOptions) {
  const {
    exportMenuOptions,
    isRenaming,
    notesPath,
    onAutoRename,
    onClearMessages,
    onDelete,
    onPinTopic,
    onPromptRename,
    t,
    topic,
    topicsLength
  } = options
  const actionContext = useMemo(
    () =>
      createTopicActionContext({
        exportMenuOptions,
        isRenaming,
        notesPath,
        onAutoRename,
        onClearMessages,
        onDelete,
        onPinTopic,
        onPromptRename,
        t,
        topic,
        topicsLength
      }),
    [
      exportMenuOptions,
      isRenaming,
      notesPath,
      onAutoRename,
      onClearMessages,
      onDelete,
      onPinTopic,
      onPromptRename,
      t,
      topic,
      topicsLength
    ]
  )
  const menuActions = useMemo(() => getTopicMenuActions(actionContext), [actionContext])
  const handleMenuAction = useCallback(
    async (action: ResolvedAction<TopicActionContext>) => {
      await runTopicMenuAction(action, actionContext)
    },
    [actionContext]
  )

  return { actionContext, menuActions, handleMenuAction }
}
