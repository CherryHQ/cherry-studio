import { ExclamationCircleOutlined } from '@ant-design/icons'
import { Button, Flex, Spinner } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useReorder } from '@data/hooks/useReorder'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import PromptEditModal from '@renderer/components/PromptEditModal'
import { useTheme } from '@renderer/context/ThemeProvider'
import FileItem from '@renderer/pages/files/FileItem'
import { getPromptVersionRollbackMarker } from '@renderer/utils/promptVersion'
import type { Prompt, PromptVariable, PromptVersion } from '@shared/data/types/prompt'
import { Modal, Popconfirm } from 'antd'
import { HistoryIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const PromptSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pendingDeletePromptId, setPendingDeletePromptId] = useState<string | null>(null)
  const [pendingRollbackVersion, setPendingRollbackVersion] = useState<number | null>(null)

  const { data: promptsList = [], isLoading: isPromptsLoading, error: promptsError } = useQuery('/prompts')

  const promptPath: `/prompts/${string}` = `/prompts/${editingPrompt?.id ?? '__pending__'}`
  const deletePromptPath: `/prompts/${string}` = `/prompts/${pendingDeletePromptId ?? '__pending__'}`
  const versionsPath: `/prompts/${string}/versions` = `/prompts/${editingPrompt?.id ?? '__pending__'}/versions`
  const rollbackPath: `/prompts/${string}/rollback` = `/prompts/${editingPrompt?.id ?? '__pending__'}/rollback`

  const {
    data: versionsRaw,
    isLoading: isVersionsLoading,
    error: versionsError,
    refetch: refetchVersions
  } = useQuery(versionsPath, {
    enabled: isVersionModalOpen && !!editingPrompt
  })
  const versions = (versionsRaw || []) as PromptVersion[]

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

  const { trigger: rollbackPrompt, isLoading: isRollingBack } = useMutation('POST', rollbackPath, {
    refresh: ['/prompts', promptPath, versionsPath],
    onError: () => window.toast.error(t('message.error.unknown'))
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

  useEffect(() => {
    if (versionsError && isVersionModalOpen) {
      window.toast.error(t('message.error.unknown'))
    }
  }, [isVersionModalOpen, t, versionsError])

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

  const handleModalSave = async (data: { title: string; content: string; variables: PromptVariable[] | null }) => {
    try {
      if (editingPrompt) {
        await updatePrompt({ body: data })
      } else {
        await createPrompt({ body: data })
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

  const handleShowVersions = (prompt: Prompt) => {
    setEditingPrompt(prompt)
    setIsVersionModalOpen(true)
  }

  useEffect(() => {
    if (isVersionModalOpen && editingPrompt) {
      refetchVersions()
    }
  }, [editingPrompt, isVersionModalOpen, refetchVersions])

  const handleRollback = async (version: number) => {
    if (!editingPrompt) return

    setPendingRollbackVersion(version)
    try {
      await rollbackPrompt({
        body: { version }
      })
      setIsVersionModalOpen(false)
    } catch {
      // handled by useMutation onError
    } finally {
      setPendingRollbackVersion(null)
    }
  }

  const reversedPrompts = useMemo(() => [...promptsList].reverse(), [promptsList])
  const isSavingPrompt = isCreatingPrompt || isUpdatingPrompt
  const getRollbackMarker = (version: Pick<PromptVersion, 'rollbackFrom'>) =>
    getPromptVersionRollbackMarker(version.rollbackFrom, (rollbackFrom) =>
      t('settings.prompts.restoredFromVersion', { version: rollbackFrom })
    )

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
                          <span className="whitespace-nowrap rounded bg-[var(--color-primary-bg)] px-1.5 py-0.5 text-[11px] text-[var(--color-primary)]">
                            v{prompt.currentVersion}
                          </span>
                        </div>
                      ),
                      actions: (
                        <Flex className="gap-1 opacity-60">
                          <Button key="versions" variant="ghost" onClick={() => handleShowVersions(prompt)} size="icon">
                            <HistoryIcon size={14} />
                          </Button>
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

      {/* Version History Modal */}
      <Modal
        title={t('settings.prompts.versionHistory')}
        open={isVersionModalOpen}
        onCancel={() => setIsVersionModalOpen(false)}
        footer={null}
        width={600}
        transitionName="animation-move-down"
        centered>
        <div className="max-h-[420px] overflow-y-auto pr-4" style={{ scrollbarGutter: 'stable' }}>
          {isVersionsLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner text={t('common.loading')} />
            </div>
          ) : versionsError ? (
            <div className="flex min-h-40 items-center justify-center text-[var(--color-text-3)] text-sm">
              {t('message.error.unknown')}
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {versions.map((version) => (
                <div key={version.id} className="flex gap-3 py-4 first:pt-1 last:pb-1">
                  <div
                    className={`mt-1 h-10 w-1 shrink-0 rounded-full ${
                      editingPrompt?.currentVersion === version.version
                        ? 'bg-[var(--color-primary)]'
                        : 'bg-[var(--color-border)]'
                    }`}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-[var(--color-text)]">
                        <span className="font-semibold">v{version.version}</span>
                        {getRollbackMarker(version) && (
                          <span className="text-[12px] text-[var(--color-text-3)]">({getRollbackMarker(version)})</span>
                        )}
                        {editingPrompt?.currentVersion === version.version && (
                          <span className="rounded bg-[var(--color-primary-bg)] px-1.5 py-0.5 text-[11px] text-[var(--color-primary)]">
                            {t('settings.prompts.current')}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 pt-0.5 text-[12px] text-[var(--color-text-3)]">
                        {new Date(version.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[13px] text-[var(--color-text-2)] leading-[1.6]">
                      {version.content.slice(0, 100)}
                      {version.content.length > 100 ? '...' : ''}
                    </div>
                    {editingPrompt?.currentVersion !== version.version && (
                      <div className="flex justify-end">
                        <Popconfirm
                          title={t('settings.prompts.rollbackConfirm')}
                          okText={t('common.confirm')}
                          cancelText={t('common.cancel')}
                          onConfirm={() => handleRollback(version.version)}>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={isRollingBack && pendingRollbackVersion === version.version}>
                            <RotateCcwIcon size={14} />
                            {t('settings.prompts.rollback')}
                          </Button>
                        </Popconfirm>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </SettingContainer>
  )
}

export default PromptSettings
