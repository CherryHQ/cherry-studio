import { ExclamationCircleOutlined } from '@ant-design/icons'
import { Button, Flex } from '@cherrystudio/ui'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { dataApiService } from '@renderer/data/DataApiService'
import FileItem from '@renderer/pages/files/FileItem'
import type { Prompt, PromptVersion } from '@shared/data/types/prompt'
import { Input, Modal, Popconfirm, Space } from 'antd'
import { HistoryIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const { TextArea } = Input

const PromptSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [promptsList, setPromptsList] = useState<Prompt[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [formData, setFormData] = useState<{ title: string; content: string }>({
    title: '',
    content: ''
  })
  const [dragging, setDragging] = useState(false)

  const loadPrompts = useCallback(async () => {
    const data = await dataApiService.get('/prompts')
    setPromptsList(data)
  }, [])

  useEffect(() => {
    loadPrompts()
  }, [loadPrompts])

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

  const handleDelete = async (id: string) => {
    await dataApiService.delete(`/prompts/${id}`)
    await loadPrompts()
  }

  const handleModalOk = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    if (editingPrompt) {
      await dataApiService.patch(`/prompts/${editingPrompt.id}`, {
        body: {
          title: formData.title,
          content: formData.content
        }
      })
    } else {
      await dataApiService.post('/prompts', {
        body: {
          title: formData.title,
          content: formData.content
        }
      })
    }
    setIsModalOpen(false)
    await loadPrompts()
  }

  const handleUpdateOrder = async (newPrompts: Prompt[]) => {
    setPromptsList(newPrompts)
    await dataApiService.patch('/prompts/reorder', {
      body: {
        items: newPrompts.map((p, i) => ({ id: p.id, sortOrder: i }))
      }
    })
  }

  const handleShowVersions = async (prompt: Prompt) => {
    setEditingPrompt(prompt)
    const data = await dataApiService.get(`/prompts/${prompt.id}/versions`)
    setVersions(data)
    setIsVersionModalOpen(true)
  }

  const handleRollback = async (version: number) => {
    if (!editingPrompt) return
    await dataApiService.post(`/prompts/${editingPrompt.id}/rollback`, {
      body: { version }
    })
    setIsVersionModalOpen(false)
    await loadPrompts()
  }

  const reversedPrompts = [...promptsList].reverse()

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
          <PromptList>
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
                      <PromptExtra>
                        <span>
                          {prompt.content.slice(0, 80)}
                          {prompt.content.length > 80 ? '...' : ''}
                        </span>
                        <VersionBadge>v{prompt.currentVersion}</VersionBadge>
                      </PromptExtra>
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
                          <Button key="delete" variant="ghost" onClick={() => {}} size="icon">
                            <DeleteIcon size={14} className="lucide-custom" />
                          </Button>
                        </Popconfirm>
                      </Flex>
                    )
                  }}
                />
              )}
            </DraggableList>
          </PromptList>
        </SettingRow>
      </SettingGroup>

      {/* Edit / Create Modal */}
      <Modal
        title={editingPrompt ? t('settings.prompts.edit') : t('settings.prompts.add')}
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => setIsModalOpen(false)}
        width={600}
        transitionName="animation-move-down"
        centered
        maskClosable={false}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Label>{t('settings.prompts.titleLabel')}</Label>
            <Input
              placeholder={t('settings.prompts.titlePlaceholder')}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div>
            <Label>{t('settings.prompts.contentLabel')}</Label>
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
        <VersionList>
          {versions.map((version) => (
            <VersionItem key={version.id}>
              <VersionInfo>
                <VersionNumber>
                  v{version.version}
                  {editingPrompt?.currentVersion === version.version && (
                    <CurrentBadge>{t('settings.prompts.current')}</CurrentBadge>
                  )}
                </VersionNumber>
                <VersionDate>{new Date(version.createdAt).toLocaleString()}</VersionDate>
              </VersionInfo>
              <VersionContent>
                {version.content.slice(0, 100)}
                {version.content.length > 100 ? '...' : ''}
              </VersionContent>
              {editingPrompt?.currentVersion !== version.version && (
                <Popconfirm
                  title={t('settings.prompts.rollbackConfirm')}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => handleRollback(version.version)}>
                  <Button variant="ghost" size="sm">
                    <RotateCcwIcon size={14} />
                    {t('settings.prompts.rollback')}
                  </Button>
                </Popconfirm>
              )}
            </VersionItem>
          ))}
        </VersionList>
      </Modal>
    </SettingContainer>
  )
}

const Label = styled.div`
  font-size: 14px;
  color: var(--color-text);
  margin-bottom: 4px;
`

const PromptList = styled.div`
  width: 100%;
  height: calc(100vh - 162px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PromptExtra = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-3);
`

const VersionBadge = styled.span`
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  white-space: nowrap;
`

const VersionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
`

const VersionItem = styled.div`
  border: 0.5px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const VersionInfo = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`

const VersionNumber = styled.div`
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const CurrentBadge = styled.span`
  font-size: 11px;
  font-weight: 400;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
`

const VersionDate = styled.span`
  font-size: 12px;
  color: var(--color-text-3);
`

const VersionContent = styled.div`
  font-size: 13px;
  color: var(--color-text-2);
  line-height: 1.5;
`

export default PromptSettings
