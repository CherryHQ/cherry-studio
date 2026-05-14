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
  onStartRename: TopicMenuHandler
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
  onStartRename,
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
    onStartRename,
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

export type TopicMenuActionContextOverride = Partial<Pick<TopicActionContext, 'onStartRename'>>

export interface TopicMenuPreset<TItem> {
  getActions: (item: TItem, contextOverride?: TopicMenuActionContextOverride) => readonly ResolvedAction[]
  onAction: (
    item: TItem,
    action: ResolvedAction,
    contextOverride?: TopicMenuActionContextOverride
  ) => void | Promise<void>
}

export function useTopicMenuPreset<TItem>({
  getActionContext
}: {
  getActionContext: (item: TItem) => TopicActionContext
}): TopicMenuPreset<TItem> {
  const getActionContextWithOverride = useCallback(
    (item: TItem, contextOverride?: TopicMenuActionContextOverride) => ({
      ...getActionContext(item),
      ...contextOverride
    }),
    [getActionContext]
  )
  const getActions = useCallback(
    (item: TItem, contextOverride?: TopicMenuActionContextOverride) =>
      getTopicMenuActions(getActionContextWithOverride(item, contextOverride)) as ResolvedAction[],
    [getActionContextWithOverride]
  )
  const onAction = useCallback(
    async (item: TItem, action: ResolvedAction, contextOverride?: TopicMenuActionContextOverride) => {
      await runTopicMenuAction(
        action as ResolvedAction<TopicActionContext>,
        getActionContextWithOverride(item, contextOverride)
      )
    },
    [getActionContextWithOverride]
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
    onStartRename,
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
        onStartRename,
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
      onStartRename,
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
