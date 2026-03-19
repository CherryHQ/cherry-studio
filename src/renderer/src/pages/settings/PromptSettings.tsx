import { ExclamationCircleOutlined } from '@ant-design/icons'
import { Button, Flex, Spinner } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import FileItem from '@renderer/pages/files/FileItem'
import type { Prompt, PromptVersion } from '@shared/data/types/prompt'
import { Input, Modal, Popconfirm, Space } from 'antd'
import { HistoryIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const { TextArea } = Input

const PromptSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [formData, setFormData] = useState<{ title: string; content: string }>({
    title: '',
    content: ''
  })
  const [dragging, setDragging] = useState(false)
  const [pendingDeletePromptId, setPendingDeletePromptId] = useState<string | null>(null)
  const [pendingRollbackVersion, setPendingRollbackVersion] = useState<number | null>(null)

  const {
    data: promptsList = [],
    isLoading: isPromptsLoading,
    error: promptsError
  } = useQuery('/prompts', {
    query: { scope: 'global' }
  })

  const promptPath: `/prompts/${string}` = `/prompts/${editingPrompt?.id ?? '__pending__'}`
  const deletePromptPath: `/prompts/${string}` = `/prompts/${pendingDeletePromptId ?? '__pending__'}`
  const versionsPath: `/prompts/${string}/versions` = `/prompts/${editingPrompt?.id ?? '__pending__'}/versions`
  const rollbackPath: `/prompts/${string}/rollback` = `/prompts/${editingPrompt?.id ?? '__pending__'}/rollback`

  const {
    data: versionsRaw,
    isLoading: isVersionsLoading,
    error: versionsError
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

  const { trigger: reorderPrompts } = useMutation('PATCH', '/prompts/reorder', {
    refresh: ['/prompts'],
    onError: () => window.toast.error(t('message.error.unknown'))
  })

  const { trigger: rollbackPrompt, isLoading: isRollingBack } = useMutation('POST', rollbackPath, {
    refresh: ['/prompts'],
    onError: () => window.toast.error(t('message.error.unknown'))
  })

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
    setFormData({ title: '', content: '' })
    setIsModalOpen(true)
  }

  const handleEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt)
    setFormData({
      title: prompt.title,
      content: prompt.content
    })
    setIsModalOpen(true)
  }

  const handleDelete = (id: string) => {
    setPendingDeletePromptId(id)
  }

  const handleModalOk = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    try {
      if (editingPrompt) {
        await updatePrompt({
          body: {
            title: formData.title,
            content: formData.content
          }
        })
      } else {
        await createPrompt({
          body: {
            title: formData.title,
            content: formData.content
          }
        })
      }
      setIsModalOpen(false)
    } catch {
      // handled by useMutation onError
    }
  }

  const handleUpdateOrder = async (newPrompts: Prompt[]) => {
    try {
      await reorderPrompts({
        body: {
          items: newPrompts.map((p, i) => ({ id: p.id, sortOrder: i }))
        }
      })
    } catch {
      // handled by useMutation onError
    }
  }

  const handleShowVersions = (prompt: Prompt) => {
    setEditingPrompt(prompt)
    setIsVersionModalOpen(true)
  }

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

      {/* Edit / Create Modal */}
      <Modal
        title={editingPrompt ? t('settings.prompts.edit') : t('settings.prompts.add')}
        open={isModalOpen}
        onOk={handleModalOk}
        confirmLoading={isSavingPrompt}
        onCancel={() => setIsModalOpen(false)}
        width={600}
        transitionName="animation-move-down"
        centered
        maskClosable={false}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div className="mb-1 text-[var(--color-text)] text-sm">{t('settings.prompts.titleLabel')}</div>
            <Input
              placeholder={t('settings.prompts.titlePlaceholder')}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div>
            <div className="mb-1 text-[var(--color-text)] text-sm">{t('settings.prompts.contentLabel')}</div>
            <TextArea
              placeholder={t('settings.prompts.contentPlaceholder')}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={8}
              style={{ resize: 'none' }}
            />
          </div>
        </Space>
      </Modal>

      {/* Version History Modal */}
      <Modal
        title={t('settings.prompts.versionHistory')}
        open={isVersionModalOpen}
        onCancel={() => setIsVersionModalOpen(false)}
        footer={null}
        width={600}
        transitionName="animation-move-down"
        centered>
        <div className="flex max-h-[400px] flex-col gap-2 overflow-y-auto">
          {isVersionsLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner text={t('common.loading')} />
            </div>
          ) : versionsError ? (
            <div className="flex min-h-40 items-center justify-center text-[var(--color-text-3)] text-sm">
              {t('message.error.unknown')}
            </div>
          ) : (
            versions.map((version) => (
              <div
                key={version.id}
                className="flex flex-col gap-1.5 rounded-lg border-[0.5px] border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    v{version.version}
                    {editingPrompt?.currentVersion === version.version && (
                      <span className="rounded bg-[var(--color-primary-bg)] px-1.5 py-0.5 font-normal text-[11px] text-[var(--color-primary)]">
                        {t('settings.prompts.current')}
                      </span>
                    )}
                  </div>
                  <span className="text-[var(--color-text-3)] text-xs">
                    {new Date(version.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-[13px] text-[var(--color-text-2)] leading-[1.5]">
                  {version.content.slice(0, 100)}
                  {version.content.length > 100 ? '...' : ''}
                </div>
                {editingPrompt?.currentVersion !== version.version && (
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
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
    </SettingContainer>
  )
}

export default PromptSettings
