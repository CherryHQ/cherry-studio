import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { OpenInNewWindowIcon } from '@renderer/components/icons/WindowIcons'
import type { Topic } from '@renderer/types/topic'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import type { TFunction } from 'i18next'
import {
  BrushCleaning,
  Copy,
  Database,
  Edit3,
  ExternalLink,
  FileText,
  Image,
  MoveRight,
  NotebookPen,
  PanelLeft,
  PinIcon,
  PinOffIcon,
  Sparkles,
  Trash2,
  UploadIcon
} from 'lucide-react'
import type { ReactNode } from 'react'

export type TopicExportMenuOptions = Record<
  | 'docx'
  | 'image'
  | 'joplin'
  | 'markdown'
  | 'markdown_reason'
  | 'notes'
  | 'notion'
  | 'obsidian'
  | 'plain_text'
  | 'siyuan'
  | 'yuque',
  boolean
>

type TopicMenuHandler = (topic: Topic) => void | Promise<void>
type TopicMoveToAssistantHandler = (topic: Topic, assistantId: string) => void | Promise<void>

export interface TopicMoveAssistantTarget {
  id: string
  name: string
  icon?: ReactNode
}

export interface TopicActionContext {
  exportMenuOptions: TopicExportMenuOptions
  isActiveInCurrentTab: boolean
  isRenaming: boolean
  onAutoRename: TopicMenuHandler
  onClearMessages: TopicMenuHandler
  onCopyImage: TopicMenuHandler
  onCopyMarkdown: TopicMenuHandler
  onCopyPlainText: TopicMenuHandler
  onDelete: TopicMenuHandler
  onExportImage: TopicMenuHandler
  onExportJoplin: TopicMenuHandler
  onExportMarkdown: TopicMenuHandler
  onExportMarkdownReason: TopicMenuHandler
  onExportNotion: TopicMenuHandler
  onExportObsidian: TopicMenuHandler
  onExportSiyuan: TopicMenuHandler
  onExportWord: TopicMenuHandler
  onExportYuque: TopicMenuHandler
  assistantMoveTargets: readonly TopicMoveAssistantTarget[]
  onMoveToAssistant?: TopicMoveToAssistantHandler
  onOpenInNewTab?: TopicMenuHandler
  onOpenInNewWindow?: TopicMenuHandler
  onPinTopic: TopicMenuHandler
  onSaveToKnowledge: TopicMenuHandler
  onSaveToNotes: TopicMenuHandler
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onStartRename: TopicMenuHandler
  panePosition?: TopicTabPosition
  t: TFunction
  topic: Topic
  topicsLength: number
}

const topicActionRegistry = createActionRegistry<TopicActionContext>()
const MOVE_TO_ASSISTANT_ACTION_PREFIX = 'topic.move-to-assistant.'

function buildMoveToAssistantActionId(assistantId: string) {
  return `${MOVE_TO_ASSISTANT_ACTION_PREFIX}${encodeURIComponent(assistantId)}`
}

function getMoveToAssistantTargetId(actionId: string) {
  if (!actionId.startsWith(MOVE_TO_ASSISTANT_ACTION_PREFIX)) return undefined

  try {
    return decodeURIComponent(actionId.slice(MOVE_TO_ASSISTANT_ACTION_PREFIX.length))
  } catch {
    return undefined
  }
}

function renderMoveAssistantTargetIcon(icon: ReactNode) {
  if (!icon) return undefined

  return (
    <span className="flex size-4 items-center justify-center [&>*]:m-0 [&>*]:max-h-full [&>*]:max-w-full">{icon}</span>
  )
}

const hasExportOption = ({ exportMenuOptions }: TopicActionContext) =>
  exportMenuOptions.image ||
  exportMenuOptions.markdown ||
  exportMenuOptions.markdown_reason ||
  exportMenuOptions.docx ||
  exportMenuOptions.notion ||
  exportMenuOptions.yuque ||
  exportMenuOptions.obsidian ||
  exportMenuOptions.joplin ||
  exportMenuOptions.siyuan

topicActionRegistry.registerCommand({
  id: 'topic.auto-rename',
  run: ({ onAutoRename, topic }) => onAutoRename(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.rename',
  run: ({ onStartRename, topic }) => onStartRename(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.pin',
  run: ({ onPinTopic, topic }) => onPinTopic(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.open-in-new-tab',
  availability: ({ isActiveInCurrentTab, onOpenInNewTab }) => ({
    visible: !!onOpenInNewTab && !isActiveInCurrentTab,
    enabled: !!onOpenInNewTab && !isActiveInCurrentTab
  }),
  run: ({ onOpenInNewTab, topic }) => onOpenInNewTab?.(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.open-in-new-window',
  availability: ({ onOpenInNewWindow }) => ({
    visible: !!onOpenInNewWindow,
    enabled: !!onOpenInNewWindow
  }),
  run: ({ onOpenInNewWindow, topic }) => onOpenInNewWindow?.(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.position-left',
  availability: ({ onSetPanePosition, panePosition }) => ({
    visible: !!onSetPanePosition && !!panePosition,
    enabled: !!onSetPanePosition && panePosition !== 'left'
  }),
  run: ({ onSetPanePosition }) => onSetPanePosition?.('left')
})

topicActionRegistry.registerCommand({
  id: 'topic.position-right',
  availability: ({ onSetPanePosition, panePosition }) => ({
    visible: !!onSetPanePosition && !!panePosition,
    enabled: !!onSetPanePosition && panePosition !== 'right'
  }),
  run: ({ onSetPanePosition }) => onSetPanePosition?.('right')
})

topicActionRegistry.registerCommand({
  id: 'topic.clear-messages',
  run: ({ onClearMessages, topic }) => onClearMessages(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.save-notes',
  availability: ({ exportMenuOptions }) => ({
    visible: exportMenuOptions.notes,
    enabled: exportMenuOptions.notes
  }),
  run: ({ onSaveToNotes, topic }) => onSaveToNotes(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.save-knowledge',
  run: ({ onSaveToKnowledge, topic }) => onSaveToKnowledge(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.image',
  run: ({ onExportImage, topic }) => onExportImage(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.markdown',
  run: ({ onExportMarkdown, topic }) => onExportMarkdown(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.markdown-reason',
  run: ({ onExportMarkdownReason, topic }) => onExportMarkdownReason(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.word',
  run: ({ onExportWord, topic }) => onExportWord(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.notion',
  run: ({ onExportNotion, topic }) => onExportNotion(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.yuque',
  run: ({ onExportYuque, topic }) => onExportYuque(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.obsidian',
  run: ({ onExportObsidian, topic }) => onExportObsidian(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.joplin',
  run: ({ onExportJoplin, topic }) => onExportJoplin(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.export.siyuan',
  run: ({ onExportSiyuan, topic }) => onExportSiyuan(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.copy.image',
  availability: ({ exportMenuOptions }) => ({
    visible: exportMenuOptions.image,
    enabled: exportMenuOptions.image
  }),
  run: ({ onCopyImage, topic }) => onCopyImage(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.copy.markdown',
  run: ({ onCopyMarkdown, topic }) => onCopyMarkdown(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.copy.plain-text',
  availability: ({ exportMenuOptions }) => ({
    visible: exportMenuOptions.plain_text,
    enabled: exportMenuOptions.plain_text
  }),
  run: ({ onCopyPlainText, topic }) => onCopyPlainText(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.delete',
  run: ({ onDelete, topic }) => onDelete(topic)
})

topicActionRegistry.registerAction({
  id: 'topic.auto-rename',
  commandId: 'topic.auto-rename',
  label: ({ t }) => t('chat.topics.auto_rename'),
  icon: () => <Sparkles size={14} />,
  order: 10,
  surface: 'menu',
  availability: ({ isRenaming }) => ({ enabled: !isRenaming })
})

topicActionRegistry.registerAction({
  id: 'topic.rename',
  commandId: 'topic.rename',
  label: ({ t }) => t('chat.topics.edit.title'),
  icon: () => <Edit3 size={14} />,
  order: 20,
  surface: 'menu',
  availability: ({ isRenaming }) => ({ enabled: !isRenaming })
})

topicActionRegistry.registerAction({
  id: 'topic.pin',
  commandId: 'topic.pin',
  label: ({ t, topic }) => (topic.pinned ? t('chat.topics.unpin') : t('chat.topics.pin')),
  icon: ({ topic }) => (topic.pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />),
  order: 30,
  surface: 'menu'
})

topicActionRegistry.registerAction({
  id: 'topic.move-to-assistant',
  label: ({ t }) => t('chat.topics.move_to'),
  icon: () => <MoveRight size={14} />,
  order: 34,
  surface: 'menu',
  availability: ({ assistantMoveTargets, onMoveToAssistant }) => ({
    visible: !!onMoveToAssistant && assistantMoveTargets.length > 0,
    enabled: !!onMoveToAssistant && assistantMoveTargets.length > 0
  }),
  children: ({ assistantMoveTargets }) =>
    assistantMoveTargets.map((target, index) => ({
      id: buildMoveToAssistantActionId(target.id),
      label: target.name,
      icon: renderMoveAssistantTargetIcon(target.icon),
      order: index,
      surface: 'menu'
    }))
})

topicActionRegistry.registerAction({
  id: 'topic.open-in-new-tab',
  commandId: 'topic.open-in-new-tab',
  label: ({ t }) => t('common.open_in_new_tab'),
  icon: () => <ExternalLink size={14} />,
  order: 35,
  surface: 'menu'
})

topicActionRegistry.registerAction({
  id: 'topic.open-in-new-window',
  commandId: 'topic.open-in-new-window',
  label: ({ t }) => t('tab.open_in_new_window'),
  icon: () => <OpenInNewWindowIcon size={14} />,
  order: 37,
  surface: 'menu'
})

topicActionRegistry.registerAction({
  id: 'topic.position',
  label: ({ t }) => t('settings.topic.position.label'),
  icon: () => <PanelLeft size={14} />,
  order: 38,
  surface: 'menu',
  availability: ({ onSetPanePosition, panePosition }) => ({ visible: !!onSetPanePosition && !!panePosition }),
  children: [
    {
      id: 'topic.position-left',
      commandId: 'topic.position-left',
      label: ({ t }) => t('settings.topic.position.left'),
      order: 10,
      surface: 'menu'
    },
    {
      id: 'topic.position-right',
      commandId: 'topic.position-right',
      label: ({ t }) => t('settings.topic.position.right'),
      order: 20,
      surface: 'menu'
    }
  ]
})

topicActionRegistry.registerAction({
  id: 'topic.clear-messages',
  commandId: 'topic.clear-messages',
  label: ({ t }) => t('chat.topics.clear.title'),
  icon: () => <BrushCleaning size={14} />,
  order: 40,
  surface: 'menu'
})

topicActionRegistry.registerAction({
  id: 'topic.save-notes',
  commandId: 'topic.save-notes',
  label: ({ t }) => t('notes.save'),
  icon: () => <NotebookPen size={14} />,
  group: 'share',
  order: 50,
  surface: 'menu'
})

topicActionRegistry.registerAction({
  id: 'topic.save-knowledge',
  commandId: 'topic.save-knowledge',
  label: ({ t }) => t('chat.save.topic.knowledge.menu_title'),
  icon: () => <Database size={14} />,
  group: 'share',
  order: 60,
  surface: 'menu'
})

topicActionRegistry.registerAction({
  id: 'topic.export',
  label: ({ t }) => t('chat.topics.export.title'),
  icon: () => <UploadIcon size={14} />,
  group: 'share',
  order: 70,
  surface: 'menu',
  availability: (context) => ({ visible: hasExportOption(context) }),
  children: [
    {
      id: 'topic.export.image',
      commandId: 'topic.export.image',
      label: ({ t }) => t('chat.topics.export.image'),
      order: 10,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.image })
    },
    {
      id: 'topic.export.markdown',
      commandId: 'topic.export.markdown',
      label: ({ t }) => t('chat.topics.export.md.label'),
      order: 20,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.markdown })
    },
    {
      id: 'topic.export.markdown-reason',
      commandId: 'topic.export.markdown-reason',
      label: ({ t }) => t('chat.topics.export.md.reason'),
      order: 30,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.markdown_reason })
    },
    {
      id: 'topic.export.word',
      commandId: 'topic.export.word',
      label: ({ t }) => t('chat.topics.export.word'),
      order: 40,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.docx })
    },
    {
      id: 'topic.export.notion',
      commandId: 'topic.export.notion',
      label: ({ t }) => t('chat.topics.export.notion'),
      order: 50,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.notion })
    },
    {
      id: 'topic.export.yuque',
      commandId: 'topic.export.yuque',
      label: ({ t }) => t('chat.topics.export.yuque'),
      order: 60,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.yuque })
    },
    {
      id: 'topic.export.obsidian',
      commandId: 'topic.export.obsidian',
      label: ({ t }) => t('chat.topics.export.obsidian'),
      order: 70,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.obsidian })
    },
    {
      id: 'topic.export.joplin',
      commandId: 'topic.export.joplin',
      label: ({ t }) => t('chat.topics.export.joplin'),
      order: 80,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.joplin })
    },
    {
      id: 'topic.export.siyuan',
      commandId: 'topic.export.siyuan',
      label: ({ t }) => t('chat.topics.export.siyuan'),
      order: 90,
      surface: 'menu',
      availability: ({ exportMenuOptions }) => ({ visible: exportMenuOptions.siyuan })
    }
  ]
})

topicActionRegistry.registerAction({
  id: 'topic.copy',
  label: ({ t }) => t('chat.topics.copy.title'),
  icon: () => <Copy size={14} />,
  group: 'share',
  order: 80,
  surface: 'menu',
  children: [
    {
      id: 'topic.copy.image',
      commandId: 'topic.copy.image',
      label: ({ t }) => t('chat.topics.copy.image'),
      icon: () => <Image size={14} />,
      order: 10,
      surface: 'menu'
    },
    {
      id: 'topic.copy.markdown',
      commandId: 'topic.copy.markdown',
      label: ({ t }) => t('chat.topics.copy.md'),
      icon: () => <FileText size={14} />,
      order: 20,
      surface: 'menu'
    },
    {
      id: 'topic.copy.plain-text',
      commandId: 'topic.copy.plain-text',
      label: ({ t }) => t('chat.topics.copy.plain_text'),
      icon: () => <FileText size={14} />,
      order: 30,
      surface: 'menu'
    }
  ]
})

topicActionRegistry.registerAction({
  id: 'topic.delete',
  commandId: 'topic.delete',
  label: ({ t }) => t('common.delete'),
  icon: () => <Trash2 size={14} />,
  group: 'danger',
  order: 90,
  surface: 'menu',
  danger: true,
  // Deleting the last topic is allowed — the selected assistant remains visible with an empty scoped
  // list, without creating a replacement. Pinned topics must be unpinned before deletion.
  availability: ({ topic }) => ({ visible: !topic.pinned }),
  confirm: ({ t }) => ({
    title: t('chat.topics.manage.delete.confirm.title'),
    description: t('chat.topics.manage.delete.confirm.content', { count: 1 }),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    destructive: true
  })
})

export function resolveTopicMenuActions(context: TopicActionContext): ResolvedAction<TopicActionContext>[] {
  return topicActionRegistry.resolve(context, 'menu')
}

export async function executeTopicMenuAction(
  action: ResolvedAction<TopicActionContext>,
  context: TopicActionContext
): Promise<boolean> {
  const targetAssistantId = getMoveToAssistantTargetId(action.id)
  if (targetAssistantId) {
    if (!context.onMoveToAssistant) return false
    if (context.topic.assistantId === targetAssistantId) return false
    if (!context.assistantMoveTargets.some((target) => target.id === targetAssistantId)) return false
    await context.onMoveToAssistant(context.topic, targetAssistantId)
    return true
  }

  return topicActionRegistry.execute(action.id, context)
}
