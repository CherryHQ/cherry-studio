import PromptVariableConfigPanel from '@renderer/components/PromptVariableConfigPanel'
import {
  extractVariableKeys,
  removeVariableFromContent,
  renameVariableInContent
} from '@renderer/utils/promptVariables'
import type { Prompt, PromptVariable } from '@shared/data/types/prompt'
import { Input, Modal, Space } from 'antd'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input

interface FormData {
  title: string
  content: string
  variables: PromptVariable[]
}

interface PromptEditModalProps {
  open: boolean
  prompt?: Prompt | null
  saving?: boolean
  onSave: (data: { title: string; content: string; variables: PromptVariable[] | null }) => Promise<void>
  onCancel: () => void
}

const PromptEditModal: FC<PromptEditModalProps> = ({ open, prompt, saving, onSave, onCancel }) => {
  const { t } = useTranslation()
  const [formData, setFormData] = useState<FormData>({ title: '', content: '', variables: [] })

  const isEdit = !!prompt

  useEffect(() => {
    if (open) {
      setFormData({
        title: prompt?.title ?? '',
        content: prompt?.content ?? '',
        variables: prompt?.variables ?? []
      })
    }
  }, [open, prompt])

  const cleanVariables = useCallback((data: FormData): PromptVariable[] | null => {
    const activeKeys = new Set(extractVariableKeys(data.content))
    const cleaned = data.variables
      .filter((v) => activeKeys.has(v.key))
      .map((v) => {
        if (v.type === 'select') {
          const options = v.options.filter(Boolean)
          if (options.length === 0) return null
          const defaultValue = v.defaultValue && options.includes(v.defaultValue) ? v.defaultValue : undefined
          return { ...v, options, defaultValue }
        }
        return v
      })
      .filter(Boolean) as PromptVariable[]
    return cleaned.length > 0 ? cleaned : null
  }, [])

  const handleOk = useCallback(async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      return
    }

    await onSave({
      title: formData.title,
      content: formData.content,
      variables: cleanVariables(formData)
    })
  }, [formData, onSave, cleanVariables])

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
          <PromptVariableConfigPanel
            content={formData.content}
            variables={formData.variables}
            onChange={(variables) => setFormData((prev) => ({ ...prev, variables }))}
            onKeyRename={(oldKey, newKey) =>
              setFormData((prev) => ({ ...prev, content: renameVariableInContent(prev.content, oldKey, newKey) }))
            }
            onDeleteVariable={(key) =>
              setFormData((prev) => ({ ...prev, content: removeVariableFromContent(prev.content, key) }))
            }
            onAddVariable={(key) => setFormData((prev) => ({ ...prev, content: `${prev.content}\${${key}}` }))}
          />
        </div>
      </Space>
    </Modal>
  )
}

export default PromptEditModal
