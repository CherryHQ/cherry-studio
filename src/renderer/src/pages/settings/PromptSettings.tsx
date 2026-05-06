import { ExclamationCircleOutlined } from '@ant-design/icons'
import { Button, Flex, Spinner } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import PromptEditModal from '@renderer/components/PromptEditModal'
import { useTheme } from '@renderer/context/ThemeProvider'
import FileItem from '@renderer/pages/files/FileItem'
import type { Prompt } from '@shared/data/types/prompt'
import { Popconfirm } from 'antd'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const PromptSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pendingDeletePromptId, setPendingDeletePromptId] = useState<string | null>(null)

  const { data: promptsList = [], isLoading: isPromptsLoading, error: promptsError } = useQuery('/prompts')

  const promptPath: `/prompts/${string}` = `/prompts/${editingPrompt?.id ?? '__pending__'}`
  const deletePromptPath: `/prompts/${string}` = `/prompts/${pendingDeletePromptId ?? '__pending__'}`

  const { trigger: createPrompt, isLoading: isCreatingPrompt } = useMutation('POST', '/prompts', {
    refresh: ['/prompts'],
    onError: () => window.toast.error(t('message.error.unknown'))
  })

  const { trigger: updatePrompt, isLoading: isUpdatingPrompt } = useMutation('PATCH', promptPath, {
    refresh: ['/prompts'],
    onError: () => window.toast.error(t('message.error.unknown'))
  })

  const { trigger: deletePrompt, isLoading: isDeletingPrompt } = useMutation('DELETE', deletePromptPath, {
    refresh: ['/prompts'],
    onError: () => window.toast.error(t('message.delete.failed'))
  })

  const { applyReorderedList } = useReorder('/prompts')

  const deletePromptRef = useRef(deletePrompt)
  useEffect(() => {
    deletePromptRef.current = deletePrompt
  }, [deletePrompt])

  useEffect(() => {
    if (!pendingDeletePromptId) {
      return
    }

    let cancelled = false

    const runDelete = async () => {
      try {
        await deletePromptRef.current()
      } catch {
        // handled by useMutation onError
      } finally {
        if (!cancelled) {
          setPendingDeletePromptId(null)
        }
      }
    }

    void runDelete()

    return () => {
      cancelled = true
    }
  }, [pendingDeletePromptId])

  const handleAdd = () => {
    setEditingPrompt(null)
    setIsModalOpen(true)
  }

  const handleEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt)
    setIsModalOpen(true)
  }

  const handleDelete = (id: string) => {
    setPendingDeletePromptId(id)
  }

  const handleModalSave = async (data: { title: string; content: string }) => {
    try {
      const body = {
        title: data.title,
        content: data.content
      }
      if (editingPrompt) {
        await updatePrompt({ body })
      } else {
        await createPrompt({ body })
      }
      setIsModalOpen(false)
    } catch {
      // handled by useMutation onError
    }
  }

  const handleUpdateOrder = async (newPrompts: Prompt[]) => {
    if (newPrompts.length === 0) return
    await applyReorderedList(newPrompts)
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
                onUpdate={(newList) => handleUpdateOrder([...newList].reverse())}
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
                          <Popconfirm
                            title={t('settings.prompts.delete')}
                            description={t('settings.prompts.deleteConfirm')}
                            okText={t('common.confirm')}
                            cancelText={t('common.cancel')}
                            onConfirm={() => handleDelete(prompt.id)}
                            icon={<ExclamationCircleOutlined style={{ color: 'red' }} />}>
                            <Button
                              key="delete"
                              variant="ghost"
                              onClick={() => {}}
                              size="icon"
                              loading={isDeletingPrompt && pendingDeletePromptId === prompt.id}>
                              <DeleteIcon size={14} className="lucide-custom" />
                            </Button>
                          </Popconfirm>
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
        onCancel={() => setIsModalOpen(false)}
      />
    </SettingContainer>
  )
}

export default PromptSettings
