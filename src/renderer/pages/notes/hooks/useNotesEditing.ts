import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { useInPlaceEdit } from '@renderer/hooks/useInPlaceEdit'
import { toast } from '@renderer/services/toast'
import type { NotesTreeNode, RenameNote } from '@renderer/types/note'
import { fetchNoteSummary } from '@renderer/utils/aiGeneration'

const logger = loggerService.withContext('UseNotesEditing')

interface UseNotesEditingProps {
  onRenameNode: RenameNote
}

export const useNotesEditing = ({ onRenameNode }: UseNotesEditingProps) => {
  const { t } = useTranslation()
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [renamingNodeIds, setRenamingNodeIds] = useState<Set<string>>(new Set())
  const [newlyRenamedNodeIds, setNewlyRenamedNodeIds] = useState<Set<string>>(new Set())

  const inPlaceEdit = useInPlaceEdit({
    onSave: async (newName: string) => {
      if (editingNodeId && newName) {
        const result = await onRenameNode(editingNodeId, newName)
        if (result.ok) {
          toast.success(t('common.saved'))
          logger.debug(`Renamed node ${editingNodeId} to "${result.name}"`)
        }
      }
      setEditingNodeId(null)
    },
    onCancel: () => {
      setEditingNodeId(null)
    }
  })

  const handleStartEdit = useCallback(
    (node: NotesTreeNode) => {
      setEditingNodeId(node.id)
      inPlaceEdit.startEdit(node.name)
    },
    [inPlaceEdit]
  )

  const handleAutoRename = useCallback(
    async (note: NotesTreeNode) => {
      if (note.type !== 'file') return

      setRenamingNodeIds((prev) => new Set(prev).add(note.id))
      let renamed = false
      try {
        const content = await window.api.file.readExternal(note.externalPath)
        if (!content || content.trim().length === 0) {
          toast.warning(t('notes.auto_rename.empty_note'))
          return
        }

        const summaryText = await fetchNoteSummary({ content })
        if (summaryText) {
          const result = await onRenameNode(note.id, summaryText)
          if (result.ok) {
            toast.success(t('notes.auto_rename.success'))
            renamed = result.name !== note.name
          }
        } else {
          toast.error(t('notes.auto_rename.failed'))
        }
      } catch (error) {
        toast.error(t('notes.auto_rename.failed'))
        logger.error(`Failed to auto-rename note: ${error}`)
      } finally {
        setRenamingNodeIds((prev) => {
          const next = new Set(prev)
          next.delete(note.id)
          return next
        })

        // Only play the "just renamed" highlight when the name actually changed.
        if (renamed) {
          setNewlyRenamedNodeIds((prev) => new Set(prev).add(note.id))

          setTimeout(() => {
            setNewlyRenamedNodeIds((prev) => {
              const next = new Set(prev)
              next.delete(note.id)
              return next
            })
          }, 700)
        }
      }
    },
    [onRenameNode, t]
  )

  return {
    editingNodeId,
    renamingNodeIds,
    newlyRenamedNodeIds,
    inPlaceEdit,
    handleStartEdit,
    handleAutoRename,
    setEditingNodeId
  }
}
