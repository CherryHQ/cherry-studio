import { ExclamationCircleOutlined } from '@ant-design/icons'
import { Flex, Input, Textarea } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import FileItem from '@renderer/pages/files/FileItem'
import { SettingDivider, SettingRow, SettingTitle } from '@renderer/pages/settings'
import type { Assistant, QuickPhrase } from '@renderer/types'
import { Modal, Popconfirm, Space } from 'antd'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

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
    <div className="flex flex-1 flex-col">
      <SettingTitle>
        {t('assistants.settings.regular_phrases.title', 'Regular Prompts')}
        <Button variant="ghost" size="icon" onClick={handleAdd}>
          <PlusIcon size={18} />
        </Button>
      </SettingTitle>
      <SettingDivider />
      <SettingRow>
        <div className="flex w-full flex-col gap-2">
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
                    <Flex className="gap-1 opacity-60">
                      <Button key="edit" variant="ghost" size="icon" onClick={() => handleEdit(prompt)}>
                        <EditIcon size={14} />
                      </Button>
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
                        <Button key="delete" variant="ghost" size="icon">
                          <DeleteIcon size={14} className="lucide-custom text-destructive" />
                        </Button>
                      </Popconfirm>
                    </Flex>
                  )
                }}
              />
            )}
          </DraggableList>
        </div>
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
            <div className="mb-2 text-foreground text-sm">
              {t('assistants.settings.regular_phrases.titleLabel', 'Title')}
            </div>
            <Input
              placeholder={t('assistants.settings.regular_phrases.titlePlaceholder', 'Enter title')}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div>
            <div className="mb-2 text-foreground text-sm">
              {t('assistants.settings.regular_phrases.contentLabel', 'Content')}
            </div>
            <Textarea.Input
              placeholder={t('assistants.settings.regular_phrases.contentPlaceholder', 'Enter content')}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={6}
              style={{ resize: 'none' }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  )
}

export default AssistantRegularPromptsSettings
