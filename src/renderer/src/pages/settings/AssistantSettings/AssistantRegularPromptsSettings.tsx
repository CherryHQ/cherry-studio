import { DeleteOutlined, EditOutlined, ExclamationCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { DraggableList } from '@renderer/components/DraggableList'
import FileItem from '@renderer/pages/files/FileItem'
import { Assistant, QuickPhrase } from '@renderer/types'
import { Button, Flex, Input, Modal, Popconfirm, Space } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { v4 as uuidv4 } from 'uuid'

import { SettingDivider, SettingRow, SettingTitle } from '..'

const { TextArea } = Input

interface AssistantRegularPromptsSettingsProps {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
}

const AssistantRegularPromptsSettings: FC<AssistantRegularPromptsSettingsProps> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()
  const [promptsList, setPromptsList] = useState<QuickPhrase[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<QuickPhrase | null>(null)
  const [formData, setFormData] = useState({ title: '', content: '' })
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    setPromptsList(assistant.regularPhrases || [])
  }, [assistant.regularPhrases])

  const handleAdd = () => {
    setEditingPrompt(null)
    setFormData({ title: '', content: '' })
    setIsModalOpen(true)
  }

  const handleEdit = (prompt: QuickPhrase) => {
    setEditingPrompt(prompt)
    setFormData({ title: prompt.title, content: prompt.content })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    const updatedPrompts = promptsList.filter((prompt) => prompt.id !== id)
    setPromptsList(updatedPrompts)
    updateAssistant({ ...assistant, regularPhrases: updatedPrompts })
  }

  const handleModalOk = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    let updatedPrompts: QuickPhrase[]
    if (editingPrompt) {
      updatedPrompts = promptsList.map((prompt) =>
        prompt.id === editingPrompt.id ? { ...prompt, ...formData } : prompt
      )
    } else {
      const newPrompt: QuickPhrase = {
        id: uuidv4(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...formData
      }
      updatedPrompts = [...promptsList, newPrompt]
    }
    setPromptsList(updatedPrompts)
    updateAssistant({ ...assistant, regularPhrases: updatedPrompts })
    setIsModalOpen(false)
  }

  const handleUpdateOrder = async (newPrompts: QuickPhrase[]) => {
    setPromptsList(newPrompts)
    updateAssistant({ ...assistant, regularPhrases: newPrompts })
  }

  const reversedPrompts = [...promptsList].reverse()

  return (
    <Container>
      <SettingTitle>
        {t('assistants.settings.regular_phrases.title', 'Regular Prompts')}
        <Button type="text" icon={<PlusOutlined />} onClick={handleAdd} />
      </SettingTitle>
      <SettingDivider />
      <SettingRow>
        <StyledPromptList>
          <DraggableList
            list={reversedPrompts}
            onUpdate={(newPrompts) => handleUpdateOrder([...newPrompts].reverse())}
            style={{ paddingBottom: dragging ? '34px' : 0 }}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => setDragging(false)}>
            {(prompt) => (
              <FileItem
                key={prompt.id}
                fileInfo={{
                  name: prompt.title,
                  ext: '.txt',
                  extra: prompt.content,
                  actions: (
                    <Flex gap={4} style={{ opacity: 0.6 }}>
                      <Button key="edit" type="text" icon={<EditOutlined />} onClick={() => handleEdit(prompt)} />
                      <Popconfirm
                        title={t('assistants.settings.regular_phrases.delete', 'Delete Prompt')}
                        description={t(
                          'assistants.settings.regular_phrases.deleteConfirm',
                          'Are you sure to delete this prompt?'
                        )}
                        okText={t('common.confirm')}
                        cancelText={t('common.cancel')}
                        onConfirm={() => handleDelete(prompt.id)}
                        icon={<ExclamationCircleOutlined style={{ color: 'red' }} />}>
                        <Button key="delete" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Flex>
                  )
                }}
              />
            )}
          </DraggableList>
        </StyledPromptList>
      </SettingRow>

      <Modal
        title={
          editingPrompt
            ? t('assistants.settings.regular_phrases.edit', 'Edit Prompt')
            : t('assistants.settings.regular_phrases.add', 'Add Prompt')
        }
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => setIsModalOpen(false)}
        width={520}
        transitionName="animation-move-down"
        centered>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Label>{t('assistants.settings.regular_phrases.titleLabel', 'Title')}</Label>
            <Input
              placeholder={t('assistants.settings.regular_phrases.titlePlaceholder', 'Enter title')}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div>
            <Label>{t('assistants.settings.regular_phrases.contentLabel', 'Content')}</Label>
            <TextArea
              placeholder={t('assistants.settings.regular_phrases.contentPlaceholder', 'Enter content')}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={6}
              style={{ resize: 'none' }}
            />
          </div>
        </Space>
      </Modal>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
`

const Label = styled.div`
  font-size: 14px;
  color: var(--color-text);
  margin-bottom: 8px;
`

const StyledPromptList = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export default AssistantRegularPromptsSettings
