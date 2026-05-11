import {
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
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

  const renderMenuItems = useCallback(
    (node: NotesTreeNode) => {
      const isFolder = node.type === 'folder'
      return (
        <>
          {!isFolder && (
            <ContextMenuItem disabled={renamingNodeIds.has(node.id)} onSelect={() => handleAutoRename(node)}>
              <ContextMenuItemContent icon={<Sparkles size={14} />}>
                {t('notes.auto_rename.label')}
              </ContextMenuItemContent>
            </ContextMenuItem>
          )}

          {isFolder && (
            <>
              <ContextMenuItem onSelect={() => onCreateNote(t('notes.untitled_note'), node.id)}>
                <ContextMenuItemContent icon={<FilePlus size={14} />}>{t('notes.new_note')}</ContextMenuItemContent>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onCreateFolder(t('notes.untitled_folder'), node.id)}>
                <ContextMenuItemContent icon={<Folder size={14} />}>{t('notes.new_folder')}</ContextMenuItemContent>
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}

          <ContextMenuItem onSelect={() => handleStartEdit(node)}>
            <ContextMenuItemContent icon={<Edit3 size={14} />}>{t('notes.rename')}</ContextMenuItemContent>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void window.api.openPath(node.externalPath)}>
            <ContextMenuItemContent icon={<FolderOpen size={14} />}>{t('notes.open_outside')}</ContextMenuItemContent>
          </ContextMenuItem>

          {!isFolder && (
            <>
              <ContextMenuItem onSelect={() => onToggleStar(node.id)}>
                <ContextMenuItemContent icon={node.isStarred ? <StarOff size={14} /> : <Star size={14} />}>
                  {node.isStarred ? t('notes.unstar') : t('notes.star')}
                </ContextMenuItemContent>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => void handleExportKnowledge(node)}>
                <ContextMenuItemContent icon={<FileSearch size={14} />}>
                  {t('notes.export_knowledge')}
                </ContextMenuItemContent>
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <UploadIcon size={14} />
                  {t('chat.topics.export.title')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {exportMenuOptions.image && (
                    <>
                      <ContextMenuItem onSelect={() => handleImageAction(node, 'copyImage')}>
                        {t('chat.topics.copy.image')}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => handleImageAction(node, 'exportImage')}>
                        {t('chat.topics.export.image')}
                      </ContextMenuItem>
                    </>
                  )}
                  {exportMenuOptions.markdown && (
                    <ContextMenuItem onSelect={() => void runExport(() => exportNote({ node, platform: 'markdown' }))}>
                      {t('chat.topics.export.md.label')}
                    </ContextMenuItem>
                  )}
                  {exportMenuOptions.docx && (
                    <ContextMenuItem onSelect={() => void runExport(() => exportNote({ node, platform: 'docx' }))}>
                      {t('chat.topics.export.word')}
                    </ContextMenuItem>
                  )}
                  {exportMenuOptions.notion && (
                    <ContextMenuItem onSelect={() => void runExport(() => exportNote({ node, platform: 'notion' }))}>
                      {t('chat.topics.export.notion')}
                    </ContextMenuItem>
                  )}
                  {exportMenuOptions.yuque && (
                    <ContextMenuItem onSelect={() => void runExport(() => exportNote({ node, platform: 'yuque' }))}>
                      {t('chat.topics.export.yuque')}
                    </ContextMenuItem>
                  )}
                  {exportMenuOptions.obsidian && (
                    <ContextMenuItem onSelect={() => void runExport(() => exportNote({ node, platform: 'obsidian' }))}>
                      {t('chat.topics.export.obsidian')}
                    </ContextMenuItem>
                  )}
                  {exportMenuOptions.joplin && (
                    <ContextMenuItem onSelect={() => void runExport(() => exportNote({ node, platform: 'joplin' }))}>
                      {t('chat.topics.export.joplin')}
                    </ContextMenuItem>
                  )}
                  {exportMenuOptions.siyuan && (
                    <ContextMenuItem onSelect={() => void runExport(() => exportNote({ node, platform: 'siyuan' }))}>
                      {t('chat.topics.export.siyuan')}
                    </ContextMenuItem>
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          )}

          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => handleDeleteNodeWrapper(node)}>
            <ContextMenuItemContent icon={<DeleteIcon size={14} className="lucide-custom" />}>
              {t('notes.delete')}
            </ContextMenuItemContent>
          </ContextMenuItem>
        </>
      )
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

  return { renderMenuItems }
}
