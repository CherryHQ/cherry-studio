import { createActionRegistry } from '@renderer/components/chat/actions/actionRegistry'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import DeleteIcon from '@renderer/components/icons/DeleteIcon'
import EditIcon from '@renderer/components/icons/EditIcon'
import { OpenInNewWindowIcon } from '@renderer/components/icons/WindowIcons'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'
import type { TFunction } from 'i18next'
import {
  Copy,
  Database,
  ExternalLink,
  FileText,
  Image,
  NotebookPen,
  PanelLeft,
  PinIcon,
  PinOffIcon,
  Sparkles,
  UploadIcon
} from 'lucide-react'

export type SessionExportMenuOptions = Record<
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

export interface SessionActionContext {
  exportMenuOptions?: Partial<SessionExportMenuOptions>
  isActiveInCurrentTab: boolean
  isRenaming?: boolean
  onAutoRename?: () => void | Promise<void>
  onCopyImage?: () => void | Promise<void>
  onCopyMarkdown?: () => void | Promise<void>
  onCopyPlainText?: () => void | Promise<void>
  onDelete: () => void
  onExportImage?: () => void | Promise<void>
  onExportJoplin?: () => void | Promise<void>
  onExportMarkdown?: () => void | Promise<void>
  onExportMarkdownReason?: () => void | Promise<void>
  onExportNotion?: () => void | Promise<void>
  onExportObsidian?: () => void | Promise<void>
  onExportSiyuan?: () => void | Promise<void>
  onExportWord?: () => void | Promise<void>
  onExportYuque?: () => void | Promise<void>
  onOpenInNewTab?: () => void
  onOpenInNewWindow?: () => void
  onSaveToKnowledge?: () => void | Promise<void>
  onSaveToNotes?: () => void | Promise<void>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  onTogglePin?: () => void
  panePosition?: TopicTabPosition
  pinned?: boolean
  sessionName: string
  startEdit: (value: string) => void
  t: TFunction
}

const sessionActionRegistry = createActionRegistry<SessionActionContext>()

const hasExportOption = ({
  exportMenuOptions,
  onExportImage,
  onExportJoplin,
  onExportMarkdown,
  onExportMarkdownReason,
  onExportNotion,
  onExportObsidian,
  onExportSiyuan,
  onExportWord,
  onExportYuque
}: SessionActionContext) =>
  (exportMenuOptions?.image && !!onExportImage) ||
  (exportMenuOptions?.markdown && !!onExportMarkdown) ||
  (exportMenuOptions?.markdown_reason && !!onExportMarkdownReason) ||
  (exportMenuOptions?.docx && !!onExportWord) ||
  (exportMenuOptions?.notion && !!onExportNotion) ||
  (exportMenuOptions?.yuque && !!onExportYuque) ||
  (exportMenuOptions?.obsidian && !!onExportObsidian) ||
  (exportMenuOptions?.joplin && !!onExportJoplin) ||
  (exportMenuOptions?.siyuan && !!onExportSiyuan)

const hasCopyOption = ({ exportMenuOptions, onCopyImage, onCopyMarkdown, onCopyPlainText }: SessionActionContext) =>
  !!onCopyMarkdown ||
  (!!exportMenuOptions?.image && !!onCopyImage) ||
  (!!exportMenuOptions?.plain_text && !!onCopyPlainText)

sessionActionRegistry.registerCommand({
  id: 'session.auto-rename',
  availability: ({ isRenaming, onAutoRename }) => ({
    visible: !!onAutoRename,
    enabled: !!onAutoRename && !isRenaming
  }),
  run: ({ onAutoRename }) => onAutoRename?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.rename',
  availability: ({ isRenaming }) => ({ enabled: !isRenaming }),
  run: ({ sessionName, startEdit }) => startEdit(sessionName)
})

sessionActionRegistry.registerCommand({
  id: 'session.toggle-pin',
  availability: ({ onTogglePin }) => ({ visible: !!onTogglePin, enabled: !!onTogglePin }),
  run: ({ onTogglePin }) => onTogglePin?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.open-in-new-tab',
  availability: ({ isActiveInCurrentTab, onOpenInNewTab }) => ({
    visible: !!onOpenInNewTab && !isActiveInCurrentTab,
    enabled: !!onOpenInNewTab && !isActiveInCurrentTab
  }),
  run: ({ onOpenInNewTab }) => onOpenInNewTab?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.open-in-new-window',
  availability: ({ onOpenInNewWindow }) => ({
    visible: !!onOpenInNewWindow,
    enabled: !!onOpenInNewWindow
  }),
  run: ({ onOpenInNewWindow }) => onOpenInNewWindow?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.save-notes',
  availability: ({ exportMenuOptions, onSaveToNotes }) => ({
    visible: !!exportMenuOptions?.notes && !!onSaveToNotes,
    enabled: !!exportMenuOptions?.notes && !!onSaveToNotes
  }),
  run: ({ onSaveToNotes }) => onSaveToNotes?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.save-knowledge',
  availability: ({ onSaveToKnowledge }) => ({ visible: !!onSaveToKnowledge, enabled: !!onSaveToKnowledge }),
  run: ({ onSaveToKnowledge }) => onSaveToKnowledge?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.image',
  availability: ({ exportMenuOptions, onExportImage }) => ({
    visible: !!exportMenuOptions?.image && !!onExportImage,
    enabled: !!exportMenuOptions?.image && !!onExportImage
  }),
  run: ({ onExportImage }) => onExportImage?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.markdown',
  availability: ({ exportMenuOptions, onExportMarkdown }) => ({
    visible: !!exportMenuOptions?.markdown && !!onExportMarkdown,
    enabled: !!exportMenuOptions?.markdown && !!onExportMarkdown
  }),
  run: ({ onExportMarkdown }) => onExportMarkdown?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.markdown-reason',
  availability: ({ exportMenuOptions, onExportMarkdownReason }) => ({
    visible: !!exportMenuOptions?.markdown_reason && !!onExportMarkdownReason,
    enabled: !!exportMenuOptions?.markdown_reason && !!onExportMarkdownReason
  }),
  run: ({ onExportMarkdownReason }) => onExportMarkdownReason?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.word',
  availability: ({ exportMenuOptions, onExportWord }) => ({
    visible: !!exportMenuOptions?.docx && !!onExportWord,
    enabled: !!exportMenuOptions?.docx && !!onExportWord
  }),
  run: ({ onExportWord }) => onExportWord?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.notion',
  availability: ({ exportMenuOptions, onExportNotion }) => ({
    visible: !!exportMenuOptions?.notion && !!onExportNotion,
    enabled: !!exportMenuOptions?.notion && !!onExportNotion
  }),
  run: ({ onExportNotion }) => onExportNotion?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.yuque',
  availability: ({ exportMenuOptions, onExportYuque }) => ({
    visible: !!exportMenuOptions?.yuque && !!onExportYuque,
    enabled: !!exportMenuOptions?.yuque && !!onExportYuque
  }),
  run: ({ onExportYuque }) => onExportYuque?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.obsidian',
  availability: ({ exportMenuOptions, onExportObsidian }) => ({
    visible: !!exportMenuOptions?.obsidian && !!onExportObsidian,
    enabled: !!exportMenuOptions?.obsidian && !!onExportObsidian
  }),
  run: ({ onExportObsidian }) => onExportObsidian?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.joplin',
  availability: ({ exportMenuOptions, onExportJoplin }) => ({
    visible: !!exportMenuOptions?.joplin && !!onExportJoplin,
    enabled: !!exportMenuOptions?.joplin && !!onExportJoplin
  }),
  run: ({ onExportJoplin }) => onExportJoplin?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.export.siyuan',
  availability: ({ exportMenuOptions, onExportSiyuan }) => ({
    visible: !!exportMenuOptions?.siyuan && !!onExportSiyuan,
    enabled: !!exportMenuOptions?.siyuan && !!onExportSiyuan
  }),
  run: ({ onExportSiyuan }) => onExportSiyuan?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.copy.image',
  availability: ({ exportMenuOptions, onCopyImage }) => ({
    visible: !!exportMenuOptions?.image && !!onCopyImage,
    enabled: !!exportMenuOptions?.image && !!onCopyImage
  }),
  run: ({ onCopyImage }) => onCopyImage?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.copy.markdown',
  availability: ({ onCopyMarkdown }) => ({ visible: !!onCopyMarkdown, enabled: !!onCopyMarkdown }),
  run: ({ onCopyMarkdown }) => onCopyMarkdown?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.copy.plain-text',
  availability: ({ exportMenuOptions, onCopyPlainText }) => ({
    visible: !!exportMenuOptions?.plain_text && !!onCopyPlainText,
    enabled: !!exportMenuOptions?.plain_text && !!onCopyPlainText
  }),
  run: ({ onCopyPlainText }) => onCopyPlainText?.()
})

sessionActionRegistry.registerCommand({
  id: 'session.position-left',
  availability: ({ onSetPanePosition, panePosition }) => ({
    visible: !!onSetPanePosition && !!panePosition,
    enabled: !!onSetPanePosition && panePosition !== 'left'
  }),
  run: ({ onSetPanePosition }) => onSetPanePosition?.('left')
})

sessionActionRegistry.registerCommand({
  id: 'session.position-right',
  availability: ({ onSetPanePosition, panePosition }) => ({
    visible: !!onSetPanePosition && !!panePosition,
    enabled: !!onSetPanePosition && panePosition !== 'right'
  }),
  run: ({ onSetPanePosition }) => onSetPanePosition?.('right')
})

sessionActionRegistry.registerCommand({
  id: 'session.delete',
  run: ({ onDelete }) => onDelete()
})

sessionActionRegistry.registerAction({
  id: 'session.auto-rename',
  commandId: 'session.auto-rename',
  label: ({ t }) => t('agent.session.auto_rename'),
  icon: () => <Sparkles size={14} />,
  order: 10,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.rename',
  commandId: 'session.rename',
  label: ({ t }) => t('agent.session.edit.title'),
  icon: () => <EditIcon size={14} />,
  order: 20,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.toggle-pin',
  commandId: 'session.toggle-pin',
  label: ({ pinned, t }) => (pinned ? t('agent.session.unpin.title') : t('agent.session.pin.title')),
  icon: ({ pinned }) => (pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />),
  order: 30,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.open-in-new-tab',
  commandId: 'session.open-in-new-tab',
  label: ({ t }) => t('common.open_in_new_tab'),
  icon: () => <ExternalLink size={14} />,
  order: 35,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.open-in-new-window',
  commandId: 'session.open-in-new-window',
  label: ({ t }) => t('tab.open_in_new_window'),
  icon: () => <OpenInNewWindowIcon size={14} />,
  order: 37,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.position',
  label: ({ t }) => t('settings.agent.position.label'),
  icon: () => <PanelLeft size={14} />,
  order: 36,
  surface: 'menu',
  availability: ({ onSetPanePosition, panePosition }) => ({ visible: !!onSetPanePosition && !!panePosition }),
  children: [
    {
      id: 'session.position-left',
      commandId: 'session.position-left',
      label: ({ t }) => t('settings.agent.position.left'),
      order: 10,
      surface: 'menu'
    },
    {
      id: 'session.position-right',
      commandId: 'session.position-right',
      label: ({ t }) => t('settings.agent.position.right'),
      order: 20,
      surface: 'menu'
    }
  ]
})

sessionActionRegistry.registerAction({
  id: 'session.save-notes',
  commandId: 'session.save-notes',
  label: ({ t }) => t('notes.save'),
  icon: () => <NotebookPen size={14} />,
  group: 'share',
  order: 50,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.save-knowledge',
  commandId: 'session.save-knowledge',
  label: ({ t }) => t('chat.save.topic.knowledge.menu_title'),
  icon: () => <Database size={14} />,
  group: 'share',
  order: 60,
  surface: 'menu'
})

sessionActionRegistry.registerAction({
  id: 'session.export',
  label: ({ t }) => t('chat.topics.export.title'),
  icon: () => <UploadIcon size={14} />,
  group: 'share',
  order: 70,
  surface: 'menu',
  availability: (context) => ({ visible: !!hasExportOption(context) }),
  children: [
    {
      id: 'session.export.image',
      commandId: 'session.export.image',
      label: ({ t }) => t('chat.topics.export.image'),
      order: 10,
      surface: 'menu'
    },
    {
      id: 'session.export.markdown',
      commandId: 'session.export.markdown',
      label: ({ t }) => t('chat.topics.export.md.label'),
      order: 20,
      surface: 'menu'
    },
    {
      id: 'session.export.markdown-reason',
      commandId: 'session.export.markdown-reason',
      label: ({ t }) => t('chat.topics.export.md.reason'),
      order: 30,
      surface: 'menu'
    },
    {
      id: 'session.export.word',
      commandId: 'session.export.word',
      label: ({ t }) => t('chat.topics.export.word'),
      order: 40,
      surface: 'menu'
    },
    {
      id: 'session.export.notion',
      commandId: 'session.export.notion',
      label: ({ t }) => t('chat.topics.export.notion'),
      order: 50,
      surface: 'menu'
    },
    {
      id: 'session.export.yuque',
      commandId: 'session.export.yuque',
      label: ({ t }) => t('chat.topics.export.yuque'),
      order: 60,
      surface: 'menu'
    },
    {
      id: 'session.export.obsidian',
      commandId: 'session.export.obsidian',
      label: ({ t }) => t('chat.topics.export.obsidian'),
      order: 70,
      surface: 'menu'
    },
    {
      id: 'session.export.joplin',
      commandId: 'session.export.joplin',
      label: ({ t }) => t('chat.topics.export.joplin'),
      order: 80,
      surface: 'menu'
    },
    {
      id: 'session.export.siyuan',
      commandId: 'session.export.siyuan',
      label: ({ t }) => t('chat.topics.export.siyuan'),
      order: 90,
      surface: 'menu'
    }
  ]
})

sessionActionRegistry.registerAction({
  id: 'session.copy',
  label: ({ t }) => t('chat.topics.copy.title'),
  icon: () => <Copy size={14} />,
  group: 'share',
  order: 80,
  surface: 'menu',
  availability: (context) => ({ visible: hasCopyOption(context) }),
  children: [
    {
      id: 'session.copy.image',
      commandId: 'session.copy.image',
      label: ({ t }) => t('chat.topics.copy.image'),
      icon: () => <Image size={14} />,
      order: 10,
      surface: 'menu'
    },
    {
      id: 'session.copy.markdown',
      commandId: 'session.copy.markdown',
      label: ({ t }) => t('chat.topics.copy.md'),
      icon: () => <FileText size={14} />,
      order: 20,
      surface: 'menu'
    },
    {
      id: 'session.copy.plain-text',
      commandId: 'session.copy.plain-text',
      label: ({ t }) => t('chat.topics.copy.plain_text'),
      icon: () => <FileText size={14} />,
      order: 30,
      surface: 'menu'
    }
  ]
})

sessionActionRegistry.registerAction({
  id: 'session.delete',
  commandId: 'session.delete',
  label: ({ t }) => t('common.delete'),
  icon: () => <DeleteIcon size={14} className="lucide-custom" />,
  group: 'danger',
  order: 90,
  surface: 'menu',
  danger: true,
  availability: ({ pinned }) => ({ visible: !pinned }),
  confirm: ({ t }) => ({
    title: t('agent.session.delete.title'),
    description: t('agent.session.delete.content'),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    destructive: true
  })
})

export function resolveSessionMenuActions(context: SessionActionContext): ResolvedAction<SessionActionContext>[] {
  return sessionActionRegistry.resolve(context, 'menu')
}

export async function executeSessionMenuAction(
  action: ResolvedAction<SessionActionContext>,
  context: SessionActionContext
): Promise<boolean> {
  return sessionActionRegistry.execute(action.id, context)
}
