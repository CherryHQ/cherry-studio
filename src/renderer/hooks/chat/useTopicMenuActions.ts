import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  executeTopicMenuAction,
  resolveTopicMenuActions,
  type TopicActionContext,
  type TopicExportMenuOptions,
  type TopicMoveAssistantTarget
} from '@renderer/components/chat/actions/topicContextMenuActions'
import { getTopicMessages } from '@renderer/hooks/useTopic'
import { ipcApi } from '@renderer/ipc'
import { type PreparedTopicExport, prepareTopicExport } from '@renderer/services/branchExportFlow'
import { copyTopicAsMarkdown, copyTopicAsPlainText } from '@renderer/services/copy'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { chooseImageExportMode } from '@renderer/services/imageExportModeChooser'
import { toast } from '@renderer/services/toast'
import type { ExportArtifact } from '@renderer/services/topicTreeExport'
import { buildTreeNotionBlocks } from '@renderer/services/topicTreeExport'
import type { Topic } from '@renderer/types/topic'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { markdownToPlainText } from '@renderer/utils/markdown'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import type { TFunction } from 'i18next'
import { useCallback, useMemo } from 'react'

type TopicMenuHandler = (topic: Topic) => void | Promise<void>
type TopicMoveToAssistantHandler = (topic: Topic, assistantId: string) => void | Promise<void>

export interface TopicMenuActionOptions {
  exportMenuOptions: TopicExportMenuOptions
  isActiveInCurrentTab: boolean
  isRenaming: boolean
  notesPath: string
  onAutoRename: TopicMenuHandler
  onClearMessages: TopicMenuHandler
  onCopyImage?: TopicMenuHandler
  onDelete: TopicMenuHandler
  onExportImage?: TopicMenuHandler
  assistantMoveTargets?: readonly TopicMoveAssistantTarget[]
  onMoveToAssistant?: TopicMoveToAssistantHandler
  onOpenInNewTab?: TopicMenuHandler
  onOpenInNewWindow?: TopicMenuHandler
  onPinTopic: TopicMenuHandler
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onStartRename: TopicMenuHandler
  panePosition?: TopicTabPosition
  t: TFunction
  topic: Topic
  topicsLength: number
}

/** Single-document markdown of a tree-prepared export; empty for file-set artifacts. */
const singleMarkdownOf = (prepared: PreparedTopicExport & { path: 'tree' }): string =>
  prepared.artifact.kind === 'single' ? prepared.artifact.markdown : ''

export function createTopicActionContext({
  exportMenuOptions,
  isActiveInCurrentTab,
  isRenaming,
  notesPath,
  assistantMoveTargets = [],
  onAutoRename,
  onClearMessages,
  onCopyImage,
  onDelete,
  onExportImage,
  onMoveToAssistant,
  onOpenInNewTab,
  onOpenInNewWindow,
  onPinTopic,
  onSetPanePosition,
  onStartRename,
  panePosition,
  t,
  topic,
  topicsLength
}: TopicMenuActionOptions): TopicActionContext {
  /**
   * Branch-aware gate for every topic-level export handler: `legacy` (no branches,
   * untouched pipeline), `tree` (pre-rendered artifact + tree), or null on cancel.
   */
  const gate = (
    topic: Topic,
    opts: { supportsFileSet: boolean; exportReasoning?: boolean; variantStyle?: 'details' | 'blockquote' }
  ) => prepareTopicExport({ topicId: topic.id, ...opts })
  const artifactDocs = (artifact: Extract<ExportArtifact, { kind: 'fileSet' }>) => [artifact.main, ...artifact.branches]

  return {
    exportMenuOptions,
    isActiveInCurrentTab,
    isRenaming,
    onAutoRename,
    onClearMessages,
    onCopyImage: onCopyImage ?? ((topic) => void EventEmitter.emit(EVENT_NAMES.COPY_TOPIC_IMAGE, topic)),
    onCopyMarkdown: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: false })
      if (!prepared) return
      if (prepared.path === 'legacy') {
        return copyTopicAsMarkdown(topic)
      }
      await navigator.clipboard.writeText(singleMarkdownOf(prepared))
    },
    onCopyPlainText: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: false })
      if (!prepared) return
      if (prepared.path === 'legacy') {
        return copyTopicAsPlainText(topic)
      }
      await navigator.clipboard.writeText(markdownToPlainText(singleMarkdownOf(prepared)))
    },
    onDelete,
    onExportImage: onExportImage ?? ((topic) => void EventEmitter.emit(EVENT_NAMES.EXPORT_TOPIC_IMAGE, topic)),
    onExportJoplin: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: true })
      if (!prepared) return
      const { exportMarkdownToJoplin } = await import('@renderer/services/ExportService')
      if (prepared.path === 'legacy') {
        const topicMessages = await getTopicMessages(topic.id)
        void exportMarkdownToJoplin(topic.name, topicMessages)
        return
      }
      if (prepared.artifact.kind === 'single') {
        void exportMarkdownToJoplin(topic.name, prepared.artifact.markdown)
      } else {
        for (const doc of artifactDocs(prepared.artifact)) {
          // Sequential awaits keep the shared export mutex happy
          await exportMarkdownToJoplin(doc.title, doc.markdown)
        }
      }
    },
    onExportMarkdown: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: true })
      if (!prepared) return
      const { exportMarkdownFileSet, exportTopicAsMarkdown } = await import('@renderer/services/ExportService')
      if (prepared.path === 'legacy') {
        return exportTopicAsMarkdown(topic, false, undefined, chooseImageExportMode)
      }
      if (prepared.artifact.kind === 'single') {
        const { saveMarkdownToDisk } = await import('@renderer/services/ExportService')
        return saveMarkdownToDisk(topic.name, prepared.artifact.markdown)
      }
      return exportMarkdownFileSet(artifactDocs(prepared.artifact))
    },
    onExportMarkdownReason: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: true, exportReasoning: true })
      if (!prepared) return
      const { exportMarkdownFileSet, exportTopicAsMarkdown, saveMarkdownToDisk } = await import(
        '@renderer/services/ExportService'
      )
      if (prepared.path === 'legacy') {
        return exportTopicAsMarkdown(topic, true, undefined, chooseImageExportMode)
      }
      if (prepared.artifact.kind === 'single') {
        return saveMarkdownToDisk(topic.name, prepared.artifact.markdown)
      }
      return exportMarkdownFileSet(artifactDocs(prepared.artifact))
    },
    onExportNotion: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: false })
      if (!prepared) return
      const { exportNotionBlocks, exportTopicToNotion } = await import('@renderer/services/ExportService')
      if (prepared.path === 'legacy') {
        await exportTopicToNotion(topic)
        return
      }
      const blocks = await buildTreeNotionBlocks(prepared.tree, prepared.mode)
      await exportNotionBlocks(topic.name, blocks)
    },
    onExportObsidian: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: false })
      if (!prepared) return
      const { default: ObsidianExportPopup } = await import('@renderer/components/ObsidianExportPopup')
      if (prepared.path === 'legacy') {
        await ObsidianExportPopup.show({ title: topic.name, topic, processingMethod: '3' })
        return
      }
      await ObsidianExportPopup.show({
        title: topic.name,
        topic,
        processingMethod: '3',
        rawContent: singleMarkdownOf(prepared)
      })
    },
    onExportSiyuan: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: true })
      if (!prepared) return
      const { exportMarkdownFileSetToSiyuan, exportMarkdownToSiyuan, topicToMarkdown } = await import(
        '@renderer/services/ExportService'
      )
      if (prepared.path === 'legacy') {
        const markdown = await topicToMarkdown(topic)
        void exportMarkdownToSiyuan(topic.name, markdown)
        return
      }
      if (prepared.artifact.kind === 'single') {
        void exportMarkdownToSiyuan(topic.name, prepared.artifact.markdown)
      } else {
        void exportMarkdownFileSetToSiyuan(artifactDocs(prepared.artifact))
      }
    },
    onExportWord: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: false, variantStyle: 'blockquote' })
      if (!prepared) return
      const { topicToMarkdown } = await import('@renderer/services/ExportService')
      const markdown = prepared.path === 'legacy' ? await topicToMarkdown(topic) : singleMarkdownOf(prepared)
      void ipcApi.request('export.word.from_markdown', {
        markdown,
        fileName: removeSpecialCharactersForFileName(topic.name)
      })
    },
    onExportYuque: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: true })
      if (!prepared) return
      const { exportMarkdownToYuque, topicToMarkdown } = await import('@renderer/services/ExportService')
      if (prepared.path === 'legacy') {
        const markdown = await topicToMarkdown(topic)
        void exportMarkdownToYuque(topic.name, markdown)
        return
      }
      if (prepared.artifact.kind === 'single') {
        void exportMarkdownToYuque(topic.name, prepared.artifact.markdown)
      } else {
        for (const doc of artifactDocs(prepared.artifact)) {
          await exportMarkdownToYuque(doc.title, doc.markdown)
        }
      }
    },
    assistantMoveTargets: assistantMoveTargets.filter((target) => target.id !== topic.assistantId),
    onMoveToAssistant,
    onOpenInNewTab,
    onOpenInNewWindow,
    onPinTopic,
    onSetPanePosition,
    onSaveToKnowledge: async (topic) => {
      try {
        const prepared = await gate(topic, { supportsFileSet: false })
        if (!prepared) return
        const { default: SaveToKnowledgePopup } = await import('@renderer/components/SaveToKnowledgePopup')
        const branchMarkdown = prepared.path === 'tree' ? singleMarkdownOf(prepared) : undefined
        const result = await SaveToKnowledgePopup.showForTopic(topic, undefined, branchMarkdown)
        if (result?.success) {
          toast.success(t('chat.save.topic.knowledge.success', { count: result.savedCount }))
        }
      } catch {
        toast.error(t('chat.save.topic.knowledge.error.save_failed'))
      }
    },
    onSaveToNotes: async (topic) => {
      const prepared = await gate(topic, { supportsFileSet: true })
      if (!prepared) return
      const { exportContentToNotes, exportTopicToNotes } = await import('@renderer/services/ExportService')
      if (prepared.path === 'legacy') {
        return exportTopicToNotes(topic, notesPath)
      }
      if (prepared.artifact.kind === 'single') {
        return exportContentToNotes(topic.name, prepared.artifact.markdown, notesPath)
      }
      for (const doc of artifactDocs(prepared.artifact)) {
        await exportContentToNotes(doc.title, doc.markdown, notesPath)
      }
    },
    onStartRename,
    panePosition,
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
    isActiveInCurrentTab,
    isRenaming,
    notesPath,
    assistantMoveTargets,
    onAutoRename,
    onClearMessages,
    onCopyImage,
    onDelete,
    onExportImage,
    onMoveToAssistant,
    onOpenInNewTab,
    onOpenInNewWindow,
    onPinTopic,
    onSetPanePosition,
    onStartRename,
    panePosition,
    t,
    topic,
    topicsLength
  } = options
  const actionContext = useMemo(
    () =>
      createTopicActionContext({
        exportMenuOptions,
        isActiveInCurrentTab,
        isRenaming,
        notesPath,
        assistantMoveTargets,
        onAutoRename,
        onClearMessages,
        onCopyImage,
        onDelete,
        onExportImage,
        onMoveToAssistant,
        onOpenInNewTab,
        onOpenInNewWindow,
        onPinTopic,
        onSetPanePosition,
        onStartRename,
        panePosition,
        t,
        topic,
        topicsLength
      }),
    [
      exportMenuOptions,
      isActiveInCurrentTab,
      isRenaming,
      notesPath,
      assistantMoveTargets,
      onAutoRename,
      onClearMessages,
      onCopyImage,
      onDelete,
      onExportImage,
      onMoveToAssistant,
      onOpenInNewTab,
      onOpenInNewWindow,
      onPinTopic,
      onSetPanePosition,
      onStartRename,
      panePosition,
      t,
      topic,
      topicsLength
    ]
  )
  const getMenuActions = useCallback(() => getTopicMenuActions(actionContext), [actionContext])
  const handleMenuAction = useCallback(
    async (action: ResolvedAction<TopicActionContext>) => {
      await runTopicMenuAction(action, actionContext)
    },
    [actionContext]
  )

  return { actionContext, getMenuActions, handleMenuAction }
}
