import { useMultiplePreferences } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { DeleteIcon } from '@renderer/components/Icons'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import type { CommandContextMenuExtraItem } from '@renderer/features/command'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import type { NotesTreeNode } from '@renderer/types/note'
import { exportNote } from '@renderer/utils/export'
import { Edit3, FilePlus, FileSearch, Folder, FolderOpen, Sparkles, Star, StarOff, UploadIcon } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('UseNotesMenu')

interface UseNotesMenuProps {
  renamingNodeIds: Set<string>
  onCreateNote: (name: string, targetFolderId?: string) => void
  onCreateFolder: (name: string, targetFolderId?: string) => void
  onRenameNode: (nodeId: string, newName: string) => void
  onToggleStar: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onSelectNode: (node: NotesTreeNode) => void
  handleStartEdit: (node: NotesTreeNode) => void
  handleAutoRename: (node: NotesTreeNode) => void
  activeNode?: NotesTreeNode | null
}

export const useNotesMenu = ({
  renamingNodeIds,
  onCreateNote,
  onCreateFolder,
  onToggleStar,
  onDeleteNode,
  onSelectNode,
  handleStartEdit,
  handleAutoRename,
  activeNode
}: UseNotesMenuProps) => {
  const { t } = useTranslation()
  const { bases } = useKnowledgeBases()
  const [exportMenuOptions] = useMultiplePreferences({
    docx: 'data.export.menus.docx',
    image: 'data.export.menus.image',
    joplin: 'data.export.menus.joplin',
    markdown: 'data.export.menus.markdown',
    notion: 'data.export.menus.notion',
    obsidian: 'data.export.menus.obsidian',
    siyuan: 'data.export.menus.siyuan',
    yuque: 'data.export.menus.yuque'
  })

  const handleExportKnowledge = useCallback(
    async (note: NotesTreeNode) => {
      try {
        if (bases.length === 0) {
          window.toast.warning(t('chat.save.knowledge.empty.no_knowledge_base'))
          return
        }

        const result = await SaveToKnowledgePopup.showForNote(note)

        if (result?.success) {
          window.toast.success(t('notes.export_success', { count: result.savedCount }))
        }
      } catch (error) {
        window.toast.error(t('notes.export_failed'))
        logger.error(`Failed to export note to knowledge base: ${error}`)
      }
    },
    [bases.length, t]
  )

  const handleImageAction = useCallback(
    async (node: NotesTreeNode, platform: 'copyImage' | 'exportImage') => {
      try {
        if (activeNode?.id !== node.id) {
          onSelectNode(node)
          await new Promise((resolve) => setTimeout(resolve, 500))
        }

        await exportNote({ node, platform })
      } catch (error) {
        logger.error(`Failed to ${platform === 'copyImage' ? 'copy' : 'export'} as image:`, error as Error)
        window.toast.error(t('common.copy_failed'))
      }
    },
    [activeNode, onSelectNode, t]
  )

  const runExport = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (error) {
        logger.error('note export failed', error as Error)
        window.toast.error(t('notes.export_failed'))
      }
    },
    [t]
  )

  const handleDeleteNodeWrapper = useCallback(
    (node: NotesTreeNode) => {
      const confirmText =
        node.type === 'folder'
          ? t('notes.delete_folder_confirm', { name: node.name })
          : t('notes.delete_note_confirm', { name: node.name })

      window.modal.confirm({
        title: t('notes.delete'),
        content: confirmText,
        centered: true,
        okButtonProps: { danger: true },
        onOk: () => {
          onDeleteNode(node.id)
        }
      })
    },
    [onDeleteNode, t]
  )

  const getMenuItems = useCallback(
    (node: NotesTreeNode): CommandContextMenuExtraItem[] => {
      const isFolder = node.type === 'folder'
      const items: CommandContextMenuExtraItem[] = []

      if (!isFolder) {
        items.push({
          type: 'item',
          id: 'notes.auto-rename',
          label: t('notes.auto_rename.label'),
          icon: <Sparkles size={14} />,
          enabled: !renamingNodeIds.has(node.id),
          onSelect: () => handleAutoRename(node)
        })
      }

      if (isFolder) {
        items.push(
          {
            type: 'item',
            id: 'notes.new-note',
            label: t('notes.new_note'),
            icon: <FilePlus size={14} />,
            onSelect: () => onCreateNote(t('notes.untitled_note'), node.id)
          },
          {
            type: 'item',
            id: 'notes.new-folder',
            label: t('notes.new_folder'),
            icon: <Folder size={14} />,
            onSelect: () => onCreateFolder(t('notes.untitled_folder'), node.id)
          },
          { type: 'separator' }
        )
      }

      items.push(
        {
          type: 'item',
          id: 'notes.rename',
          label: t('notes.rename'),
          icon: <Edit3 size={14} />,
          onSelect: () => handleStartEdit(node)
        },
        {
          type: 'item',
          id: 'notes.open-outside',
          label: t('notes.open_outside'),
          icon: <FolderOpen size={14} />,
          onSelect: () => void window.api.openPath(node.externalPath)
        }
      )

      if (!isFolder) {
        items.push(
          {
            type: 'item',
            id: 'notes.toggle-star',
            label: node.isStarred ? t('notes.unstar') : t('notes.star'),
            icon: node.isStarred ? <StarOff size={14} /> : <Star size={14} />,
            onSelect: () => onToggleStar(node.id)
          },
          {
            type: 'item',
            id: 'notes.export-knowledge',
            label: t('notes.export_knowledge'),
            icon: <FileSearch size={14} />,
            onSelect: () => void handleExportKnowledge(node)
          }
        )

        const exportChildren: CommandContextMenuExtraItem[] = []
        const addExport = (
          id: string,
          label: string,
          platform: 'markdown' | 'docx' | 'notion' | 'yuque' | 'obsidian' | 'joplin' | 'siyuan'
        ) =>
          exportChildren.push({
            type: 'item',
            id,
            label,
            onSelect: () => void runExport(() => exportNote({ node, platform }))
          })
        if (exportMenuOptions.image) {
          exportChildren.push(
            {
              type: 'item',
              id: 'notes.export.copy-image',
              label: t('chat.topics.copy.image'),
              onSelect: () => handleImageAction(node, 'copyImage')
            },
            {
              type: 'item',
              id: 'notes.export.image',
              label: t('chat.topics.export.image'),
              onSelect: () => handleImageAction(node, 'exportImage')
            }
          )
        }
        if (exportMenuOptions.markdown) addExport('notes.export.markdown', t('chat.topics.export.md.label'), 'markdown')
        if (exportMenuOptions.docx) addExport('notes.export.docx', t('chat.topics.export.word'), 'docx')
        if (exportMenuOptions.notion) addExport('notes.export.notion', t('chat.topics.export.notion'), 'notion')
        if (exportMenuOptions.yuque) addExport('notes.export.yuque', t('chat.topics.export.yuque'), 'yuque')
        if (exportMenuOptions.obsidian) addExport('notes.export.obsidian', t('chat.topics.export.obsidian'), 'obsidian')
        if (exportMenuOptions.joplin) addExport('notes.export.joplin', t('chat.topics.export.joplin'), 'joplin')
        if (exportMenuOptions.siyuan) addExport('notes.export.siyuan', t('chat.topics.export.siyuan'), 'siyuan')

        if (exportChildren.length > 0) {
          items.push({
            type: 'submenu',
            id: 'notes.export',
            label: t('chat.topics.export.title'),
            icon: <UploadIcon size={14} />,
            children: exportChildren
          })
        }
      }

      items.push(
        { type: 'separator' },
        {
          type: 'item',
          id: 'notes.delete',
          label: t('notes.delete'),
          destructive: true,
          icon: <DeleteIcon size={14} className="lucide-custom" />,
          onSelect: () => handleDeleteNodeWrapper(node)
        }
      )

      return items
    },
    [
      t,
      handleStartEdit,
      onToggleStar,
      handleExportKnowledge,
      handleImageAction,
      handleDeleteNodeWrapper,
      renamingNodeIds,
      handleAutoRename,
      exportMenuOptions,
      onCreateNote,
      onCreateFolder,
      runExport
    ]
  )

  return { getMenuItems }
}
