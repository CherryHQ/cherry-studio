import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import type { Topic } from '@renderer/types'
import type { TFunction } from 'i18next'
import {
  BrushCleaning,
  Copy,
  Database,
  Edit3,
  FileText,
  Image,
  NotebookPen,
  PinIcon,
  PinOffIcon,
  Sparkles,
  Trash2,
  UploadIcon
} from 'lucide-react'

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

export interface TopicActionContext {
  exportMenuOptions: TopicExportMenuOptions
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
  onPinTopic: TopicMenuHandler
  onPromptRename: TopicMenuHandler
  onSaveToKnowledge: TopicMenuHandler
  onSaveToNotes: TopicMenuHandler
  t: TFunction
  topic: Topic
  topicsLength: number
}

const topicActionRegistry = createActionRegistry<TopicActionContext>()

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
  id: 'topic.prompt-rename',
  run: ({ onPromptRename, topic }) => onPromptRename(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.pin',
  run: ({ onPinTopic, topic }) => onPinTopic(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.clear-messages',
  run: ({ onClearMessages, topic }) => onClearMessages(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.save-notes',
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
  run: ({ onCopyImage, topic }) => onCopyImage(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.copy.markdown',
  run: ({ onCopyMarkdown, topic }) => onCopyMarkdown(topic)
})

topicActionRegistry.registerCommand({
  id: 'topic.copy.plain-text',
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
  id: 'topic.prompt-rename',
  commandId: 'topic.prompt-rename',
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
  availability: ({ topic, topicsLength }) => ({ visible: topicsLength > 1 && !topic.pinned }),
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
  return topicActionRegistry.execute(action.id, context)
}
