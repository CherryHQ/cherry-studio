import { Button, ConfirmDialog, Flex, Spinner } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'
import { loggerService } from '@logger'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import PromptEditModal from '@renderer/components/PromptEditModal'
import { useTheme } from '@renderer/context/ThemeProvider'
import FileItem from '@renderer/pages/files/FileItem'
import type { Prompt } from '@shared/data/types/prompt'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const logger = loggerService.withContext('PromptSettings')

const PromptSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [dragging, setDragging] = useState(false)
  const [deletePromptId, setDeletePromptId] = useState<string | null>(null)

  const { data: promptsList = [], isLoading: isPromptsLoading, error: promptsError } = useQuery('/prompts')

  const { trigger: createPrompt, isLoading: isCreatingPrompt } = useMutation('POST', '/prompts', {
    refresh: ['/prompts'],
    onError: () => window.toast.error(t('message.error.unknown'))
  })

  const { trigger: updatePrompt, isLoading: isUpdatingPrompt } = useMutation('PATCH', '/prompts/:id', {
    refresh: ['/prompts'],
    onError: () => window.toast.error(t('message.error.unknown'))
  })

  const { trigger: deletePrompt, isLoading: isDeletingPrompt } = useMutation('DELETE', '/prompts/:id', {
    refresh: ['/prompts'],
    onError: () => window.toast.error(t('message.delete.failed'))
  })

  const { applyReorderedList } = useReorder('/prompts')

  const handleAdd = () => {
    setEditingPrompt(null)
    setIsModalOpen(true)
  }

  const handleEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt)
    setIsModalOpen(true)
  }

  const handleDelete = (id: string) => {
    setDeletePromptId(id)
  }

  const handleConfirmDelete = useCallback(async () => {
    if (!deletePromptId) {
      return
    }

    try {
      await deletePrompt({ params: { id: deletePromptId } })
    } catch {
      // handled by useMutation onError
    }
  }, [deletePrompt, deletePromptId])

  const handleCloseDeleteDialog = useCallback((open: boolean) => {
    if (!open) {
      setDeletePromptId(null)
    }
  }, [])

  const handleUpdateOrder = useCallback(
    async (newPrompts: Prompt[]) => {
      if (newPrompts.length === 0) return

      try {
        await applyReorderedList(newPrompts)
      } catch (error) {
        logger.error('Failed to reorder prompts', error as Error)
        window.toast.error(t('message.error.unknown'))
      }
    },
    [applyReorderedList, t]
  )

  const handleDraggableUpdate = useCallback(
    (newList: Prompt[]) => {
      void handleUpdateOrder([...newList].reverse())
    },
    [handleUpdateOrder]
  )

  const handleCancelModal = useCallback(() => {
    setIsModalOpen(false)
  }, [])

  const handleModalSave = async (data: { title: string; content: string }) => {
    try {
      const body = {
        title: data.title,
        content: data.content
      }
      if (editingPrompt) {
        await updatePrompt({ params: { id: editingPrompt.id }, body })
      } else {
        await createPrompt({ body })
      }
      handleCancelModal()
    } catch {
      // handled by useMutation onError
    }
  }

  const reversedPrompts = useMemo(() => [...promptsList].reverse(), [promptsList])
  const isSavingPrompt = isCreatingPrompt || isUpdatingPrompt

  return (
    <SettingContainer theme={theme}>
      <SettingGroup style={{ marginBottom: 0 }} theme={theme}>
        <SettingTitle>
          {t('settings.prompts.title')}
          <Button variant="ghost" onClick={handleAdd} size="icon">
            <PlusIcon size={18} />
          </Button>
        </SettingTitle>
        <SettingDivider />
        <SettingRow>
          <div className="flex h-[calc(100vh-162px)] w-full flex-col gap-2 overflow-y-auto">
            {isPromptsLoading && reversedPrompts.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner text={t('common.loading')} />
              </div>
            ) : promptsError && reversedPrompts.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[var(--color-text-3)] text-sm">
                {t('message.error.unknown')}
              </div>
            ) : (
              <DraggableList
                list={reversedPrompts}
                onUpdate={handleDraggableUpdate}
                style={{ paddingBottom: dragging ? '34px' : 0 }}
                onDragStart={() => setDragging(true)}
                onDragEnd={() => setDragging(false)}>
                {(prompt) => (
                  <FileItem
                    key={prompt.id}
                    fileInfo={{
                      name: prompt.title,
                      ext: '.txt',
                      extra: (
                        <div className="flex items-center gap-2 text-[var(--color-text-3)] text-xs">
                          <span>
                            {prompt.content.slice(0, 80)}
                            {prompt.content.length > 80 ? '...' : ''}
                          </span>
                        </div>
                      ),
                      actions: (
                        <Flex className="gap-1 opacity-60">
                          <Button key="edit" variant="ghost" onClick={() => handleEdit(prompt)} size="icon">
                            <EditIcon size={14} />
                          </Button>
                          <Button
                            key="delete"
                            variant="ghost"
                            onClick={() => handleDelete(prompt.id)}
                            size="icon"
                            loading={isDeletingPrompt && deletePromptId === prompt.id}>
                            <DeleteIcon size={14} className="lucide-custom" />
                          </Button>
                        </Flex>
                      )
                    }}
                  />
                )}
              </DraggableList>
            )}
          </div>
        </SettingRow>
      </SettingGroup>

      <PromptEditModal
        open={isModalOpen}
        prompt={editingPrompt}
        saving={isSavingPrompt}
        onSave={handleModalSave}
        onCancel={handleCancelModal}
      />
      <ConfirmDialog
        open={!!deletePromptId}
        onOpenChange={handleCloseDeleteDialog}
        title={t('settings.prompts.delete')}
        description={t('settings.prompts.deleteConfirm')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={handleConfirmDelete}
        destructive
        confirmLoading={isDeletingPrompt}
      />
    </SettingContainer>
  )
}

export default PromptSettings
