import { loggerService } from '@logger'
import type { CommandContextMenuExtraItem } from '@renderer/commands'
import { DeleteIcon } from '@renderer/components/Icons'
import SaveToKnowledgePopup from '@renderer/components/Popups/SaveToKnowledgePopup'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBases'
import type { RootState } from '@renderer/store'
import type { NotesTreeNode } from '@renderer/types/note'
import { exportNote } from '@renderer/utils/export'
import { Edit3, FilePlus, FileSearch, Folder, FolderOpen, Sparkles, Star, StarOff, UploadIcon } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

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
  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)

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
    (node: NotesTreeNode) => {
      const isFolder = node.type === 'folder'
      const items: CommandContextMenuExtraItem[] = []

      if (!isFolder) {
        items.push({
          type: 'item',
          id: `note:${node.id}:auto-rename`,
          label: t('notes.auto_rename.label'),
          enabled: !renamingNodeIds.has(node.id),
          icon: <Sparkles size={14} />,
          onSelect: () => handleAutoRename(node)
        })
      }

      if (isFolder) {
        items.push(
          {
            type: 'item',
            id: `note:${node.id}:new-note`,
            label: t('notes.new_note'),
            icon: <FilePlus size={14} />,
            onSelect: () => onCreateNote(t('notes.untitled_note'), node.id)
          },
          {
            type: 'item',
            id: `note:${node.id}:new-folder`,
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
          id: `note:${node.id}:rename`,
          label: t('notes.rename'),
          icon: <Edit3 size={14} />,
          onSelect: () => handleStartEdit(node)
        },
        {
          type: 'item',
          id: `note:${node.id}:open-outside`,
          label: t('notes.open_outside'),
          icon: <FolderOpen size={14} />,
          onSelect: () => void window.api.openPath(node.externalPath)
        }
      )

      if (!isFolder) {
        const exportItems: CommandContextMenuExtraItem[] = []
        if (exportMenuOptions.image) {
          exportItems.push(
            {
              type: 'item',
              id: `note:${node.id}:copy-image`,
              label: t('chat.topics.copy.image'),
              onSelect: () => void handleImageAction(node, 'copyImage')
            },
            {
              type: 'item',
              id: `note:${node.id}:export-image`,
              label: t('chat.topics.export.image'),
              onSelect: () => void handleImageAction(node, 'exportImage')
            }
          )
        }
        if (exportMenuOptions.markdown) {
          exportItems.push({
            type: 'item',
            id: `note:${node.id}:export-markdown`,
            label: t('chat.topics.export.md.label'),
            onSelect: () => void runExport(() => exportNote({ node, platform: 'markdown' }))
          })
        }
        if (exportMenuOptions.docx) {
          exportItems.push({
            type: 'item',
            id: `note:${node.id}:export-docx`,
            label: t('chat.topics.export.word'),
            onSelect: () => void runExport(() => exportNote({ node, platform: 'docx' }))
          })
        }
        if (exportMenuOptions.notion) {
          exportItems.push({
            type: 'item',
            id: `note:${node.id}:export-notion`,
            label: t('chat.topics.export.notion'),
            onSelect: () => void runExport(() => exportNote({ node, platform: 'notion' }))
          })
        }
        if (exportMenuOptions.yuque) {
          exportItems.push({
            type: 'item',
            id: `note:${node.id}:export-yuque`,
            label: t('chat.topics.export.yuque'),
            onSelect: () => void runExport(() => exportNote({ node, platform: 'yuque' }))
          })
        }
        if (exportMenuOptions.obsidian) {
          exportItems.push({
            type: 'item',
            id: `note:${node.id}:export-obsidian`,
            label: t('chat.topics.export.obsidian'),
            onSelect: () => void runExport(() => exportNote({ node, platform: 'obsidian' }))
          })
        }
        if (exportMenuOptions.joplin) {
          exportItems.push({
            type: 'item',
            id: `note:${node.id}:export-joplin`,
            label: t('chat.topics.export.joplin'),
            onSelect: () => void runExport(() => exportNote({ node, platform: 'joplin' }))
          })
        }
        if (exportMenuOptions.siyuan) {
          exportItems.push({
            type: 'item',
            id: `note:${node.id}:export-siyuan`,
            label: t('chat.topics.export.siyuan'),
            onSelect: () => void runExport(() => exportNote({ node, platform: 'siyuan' }))
          })
        }

        items.push(
          {
            type: 'item',
            id: `note:${node.id}:toggle-star`,
            label: node.isStarred ? t('notes.unstar') : t('notes.star'),
            icon: node.isStarred ? <StarOff size={14} /> : <Star size={14} />,
            onSelect: () => onToggleStar(node.id)
          },
          {
            type: 'item',
            id: `note:${node.id}:export-knowledge`,
            label: t('notes.export_knowledge'),
            icon: <FileSearch size={14} />,
            onSelect: () => void handleExportKnowledge(node)
          },
          {
            type: 'submenu',
            id: `note:${node.id}:export`,
            label: t('chat.topics.export.title'),
            icon: <UploadIcon size={14} />,
            children: exportItems
          }
        )
      }

      items.push(
        { type: 'separator' },
        {
          type: 'item',
          id: `note:${node.id}:delete`,
          label: t('notes.delete'),
          icon: <DeleteIcon size={14} className="lucide-custom" />,
          destructive: true,
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
