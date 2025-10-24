import { ModelGroup, ModelReference } from '@renderer/types'
import { Form, Input, Modal } from 'antd'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import ModelGroupSelector from './ModelGroupSelector'

interface Props {
  open: boolean
  group: ModelGroup | null
  onSave: (group: Omit<ModelGroup, 'id' | 'createdAt' | 'updatedAt'>) => void
  onCancel: () => void
}

const CreateModelGroupModal: FC<Props> = ({ open, group, onSave, onCancel }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      if (group) {
        form.setFieldsValue({
          name: group.name,
          description: group.description || '',
          models: group.models
        })
      } else {
        form.resetFields()
      }
    }
  }, [open, group, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      onSave({
        name: values.name,
        description: values.description,
        models: values.models || []
      })
      form.resetFields()
    } catch (error) {
      // Validation failed
    }
  }

  const handleCancel = () => {
    form.resetFields()
    onCancel()
  }

  return (
    <Modal
      title={group ? t('settings.modelGroup.edit') : t('settings.modelGroup.create')}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      width={600}
      okText={t('common.save')}
      cancelText={t('common.cancel')}>
      <Form form={form} layout="vertical" style={{ marginTop: 20 }}>
        <Form.Item
          name="name"
          label={t('settings.modelGroup.name')}
          rules={[{ required: true, message: t('settings.modelGroup.namePlaceholder') }]}>
          <Input placeholder={t('settings.modelGroup.namePlaceholder')} />
        </Form.Item>

        <Form.Item name="description" label={t('settings.modelGroup.description')}>
          <Input.TextArea
            placeholder={t('settings.modelGroup.descriptionPlaceholder')}
            rows={3}
            maxLength={200}
            showCount
          />
        </Form.Item>

        <Form.Item
          name="models"
          label={t('settings.modelGroup.models')}
          rules={[{ required: true, message: t('settings.modelGroup.selectModels') }]}>
          <ModelGroupSelector />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default CreateModelGroupModal