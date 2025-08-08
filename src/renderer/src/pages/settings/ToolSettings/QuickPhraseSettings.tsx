import { ExclamationCircleOutlined } from '@ant-design/icons'
import { DraggableList } from '@renderer/components/DraggableList'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import FileItem from '@renderer/pages/files/FileItem'
import QuickPhraseService from '@renderer/services/QuickPhraseService'
import { QuickPhrase } from '@renderer/types'
import { Button, Flex, Input, Modal, Popconfirm, Space } from 'antd'
import { PlusIcon } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '..'

const { TextArea } = Input

const QuickPhraseSettings: FC = () => {
  const { t } = useTranslation()
  const [phrasesList, setPhrasesList] = useState<QuickPhrase[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingPhrase, setEditingPhrase] = useState<QuickPhrase | null>(null)
  const [formData, setFormData] = useState({ title: '', content: '' })
  const [dragging, setDragging] = useState(false)
  const { theme } = useTheme()

  const loadPhrases = async () => {
    const data = await QuickPhraseService.getAll()
    setPhrasesList(data)
  }

  useEffect(() => {
    loadPhrases()
  }, [])

  const handleAdd = () => {
    setEditingPhrase(null)
    setFormData({ title: '', content: '' })
    setIsModalOpen(true)
  }

  const handleEdit = (phrase: QuickPhrase) => {
    setEditingPhrase(phrase)
    setFormData({ title: phrase.title, content: phrase.content })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    await QuickPhraseService.delete(id)
    await loadPhrases()
  }

  const handleModalOk = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    if (editingPhrase) {
      await QuickPhraseService.update(editingPhrase.id, formData)
    } else {
      await QuickPhraseService.add(formData)
    }
    setIsModalOpen(false)
    await loadPhrases()
  }

  const handleUpdateOrder = async (newPhrases: QuickPhrase[]) => {
    setPhrasesList(newPhrases)
    await QuickPhraseService.updateOrder(newPhrases)
  }

  const reversedPhrases = [...phrasesList].reverse()

  return (
    <SettingContainer theme={theme}>
      <SettingGroup style={{ marginBottom: 0 }} theme={theme}>
        <SettingTitle>
          {t('settings.quickPhrase.title')}
          <Button type="text" icon={<PlusIcon size={18} />} onClick={handleAdd} />
        </SettingTitle>
        <SettingDivider />
        <SettingRow>
          <QuickPhraseList>
            <DraggableList
              list={reversedPhrases}
              onUpdate={(newPhrases) => handleUpdateOrder([...newPhrases].reverse())}
              style={{ paddingBottom: dragging ? '34px' : 0 }}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}>
              {(phrase) => (
                <FileItem
                  key={phrase.id}
                  fileInfo={{
                    name: phrase.title,
                    ext: '.txt',
                    extra: phrase.content,
                    actions: (
                      <Flex gap={4} style={{ opacity: 0.6 }}>
                        <Button
                          key="edit"
                          type="text"
                          icon={<EditIcon size={14} />}
                          onClick={() => handleEdit(phrase)}
                        />
                        <Popconfirm
                          title={t('settings.quickPhrase.delete')}
                          description={t('settings.quickPhrase.deleteConfirm')}
                          okText={t('common.confirm')}
                          cancelText={t('common.cancel')}
                          onConfirm={() => handleDelete(phrase.id)}
                          icon={<ExclamationCircleOutlined style={{ color: 'red' }} />}>
                          <Button
                            key="delete"
                            type="text"
                            danger
                            icon={<DeleteIcon size={14} className="lucide-custom" />}
                          />
                        </Popconfirm>
                      </Flex>
                    )
                  }}
                />
              )}
            </DraggableList>
          </QuickPhraseList>
        </SettingRow>
      </SettingGroup>

      <Modal
        title={editingPhrase ? t('settings.quickPhrase.edit') : t('settings.quickPhrase.add')}
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => setIsModalOpen(false)}
        width={520}
        transitionName="animation-move-down"
        centered
        maskClosable={false}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Label>{t('settings.quickPhrase.titleLabel')}</Label>
            <Input
              placeholder={t('settings.quickPhrase.titlePlaceholder')}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div>
            <Label>{t('settings.quickPhrase.contentLabel')}</Label>
            <TextArea
              placeholder={t('settings.quickPhrase.contentPlaceholder')}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={6}
              style={{ resize: 'none' }}
            />
          </div>
        </Space>
      </Modal>
    </SettingContainer>
  )
}

const Label = styled.div`
  font-size: 14px;
  color: var(--color-text);
  margin-bottom: 8px;
`

const QuickPhraseList = styled.div`
  width: 100%;
  height: calc(100vh - 162px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export default QuickPhraseSettings
