import type { Prompt } from '@shared/data/types/prompt'
import { Input, Modal, Space } from 'antd'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input

interface FormData {
  title: string
  content: string
}

interface PromptEditModalProps {
  open: boolean
  prompt?: Prompt | null
  saving?: boolean
  onSave: (data: { title: string; content: string }) => Promise<void>
  onCancel: () => void
}

const PromptEditModal: FC<PromptEditModalProps> = ({ open, prompt, saving, onSave, onCancel }) => {
  const { t } = useTranslation()
  const [formData, setFormData] = useState<FormData>({ title: '', content: '' })

  const isEdit = !!prompt

  useEffect(() => {
    if (open) {
      setFormData({
        title: prompt?.title ?? '',
        content: prompt?.content ?? ''
      })
    }
  }, [open, prompt])

  const handleOk = useCallback(async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    await onSave({
      title: formData.title,
      content: formData.content
    })
  }, [formData, onSave])

  return (
    <Modal
      title={isEdit ? t('settings.prompts.edit') : t('settings.prompts.add')}
      open={open}
      onOk={handleOk}
      confirmLoading={saving}
      onCancel={onCancel}
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
  )
}

export default PromptEditModal
