import { DownOutlined, UpOutlined } from '@ant-design/icons'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import { Model, ModelTypes } from '@renderer/types'
import { getDefaultGroupName } from '@renderer/utils'
import { Button, Checkbox, Divider, Flex, Form, Input, message, Modal } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
interface ModelEditContentProps {
  model: Model
  onUpdateModel: (model: Model) => void
  open: boolean
  onClose: () => void
}

const ModelEditContent: FC<ModelEditContentProps> = ({ model, onUpdateModel, open, onClose }) => {
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const [showModelTypes, setShowModelTypes] = useState(false)
  const [editingModel, setEditingModel] = useState<Model | null>(null)

  useEffect(() => {
    if (open && model) {
      const initialTypes = model.type ? { ...model.type } : {}
      setEditingModel({ ...model, type: initialTypes })
      form.setFieldsValue({
        id: model.id,
        name: model.name,
        group: model.group
      })
    } else if (!open) {
      setEditingModel(null)
      setShowModelTypes(false)
    }
  }, [open, model, form])

  const handleModelTypeChange = (typeKey: keyof ModelTypes, isChecked: boolean) => {
    setEditingModel((prev) => {
      if (!prev) return null
      const newTypes = {
        ...(prev.type || {}),
        [typeKey]: isChecked
      }
      return { ...prev, type: newTypes }
    })
  }

  const onFinish = (values: any) => {
    if (!editingModel) return

    const finalModel = {
      ...editingModel,
      id: values.id || editingModel.id,
      name: values.name || editingModel.name,
      group: values.group || editingModel.group
    }
    onUpdateModel(finalModel)
    setShowModelTypes(false)
    onClose()
  }
  const handleClose = () => {
    setShowModelTypes(false)
    onClose()
  }
  return (
    <Modal
      title={t('models.edit')}
      open={open}
      onCancel={handleClose}
      footer={null}
      maskClosable={false}
      transitionName="animation-move-down"
      centered
      afterOpenChange={(visible) => {
        if (visible) {
          form.getFieldInstance('id')?.focus()
        } else {
          setShowModelTypes(false)
        }
      }}>
      <Form
        form={form}
        labelCol={{ flex: '110px' }}
        labelAlign="left"
        colon={false}
        style={{ marginTop: 15 }}
        onFinish={onFinish}>
        <Form.Item
          name="id"
          label={t('settings.models.add.model_id')}
          tooltip={t('settings.models.add.model_id.tooltip')}
          rules={[{ required: true }]}>
          <Flex justify="space-between" gap={5}>
            <Input
              placeholder={t('settings.models.add.model_id.placeholder')}
              spellCheck={false}
              maxLength={200}
              disabled={true}
              value={model.id}
              onChange={(e) => {
                const value = e.target.value
                form.setFieldValue('name', value)
                form.setFieldValue('group', getDefaultGroupName(value))
              }}
            />
            <Button
              onClick={() => {
                //copy model id
                const val = form.getFieldValue('name')
                navigator.clipboard.writeText((val.id || model.id) as string)
                message.success(t('message.copied'))
              }}>
              <CopyIcon /> {t('chat.topics.copy.title')}
            </Button>
          </Flex>
        </Form.Item>
        <Form.Item
          name="name"
          label={t('settings.models.add.model_name')}
          tooltip={t('settings.models.add.model_name.tooltip')}>
          <Input placeholder={t('settings.models.add.model_name.placeholder')} spellCheck={false} />
        </Form.Item>
        <Form.Item
          name="group"
          label={t('settings.models.add.group_name')}
          tooltip={t('settings.models.add.group_name.tooltip')}>
          <Input placeholder={t('settings.models.add.group_name.placeholder')} spellCheck={false} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 15, textAlign: 'center' }}>
          <Flex justify="space-between" align="center" style={{ position: 'relative' }}>
            <MoreSettingsRow onClick={() => setShowModelTypes(!showModelTypes)}>
              {t('settings.moresetting')}
              <ExpandIcon>{showModelTypes ? <UpOutlined /> : <DownOutlined />}</ExpandIcon>
            </MoreSettingsRow>
            <Button type="primary" htmlType="submit" size="middle">
              {t('common.save')}
            </Button>
          </Flex>
        </Form.Item>
        {showModelTypes && (
          <div>
            <Divider style={{ margin: '0 0 15px 0' }} />
            <TypeTitle>{t('models.type.select')}:</TypeTitle>
            <Flex wrap="wrap" gap="middle">
              {[
                { typeName: 'vision', label: t('models.type.vision'), checker: isVisionModel },
                { typeName: 'web_search', label: t('models.type.websearch'), checker: isWebSearchModel },
                { typeName: 'embedding', label: t('models.type.embedding'), checker: isEmbeddingModel },
                { typeName: 'reasoning', label: t('models.type.reasoning'), checker: isReasoningModel },
                {
                  typeName: 'function_calling',
                  label: t('models.type.function_calling'),
                  checker: isFunctionCallingModel
                }
              ].map(({ typeName, label, checker }) => {
                const typeKey = typeName as keyof ModelTypes
                return (
                  <TypeCheckboxItem
                    key={typeKey}
                    originalModelForChecker={model}
                    currentTypeState={editingModel?.type?.[typeKey]}
                    typeKey={typeKey}
                    label={label}
                    checker={checker}
                    onTypeChange={handleModelTypeChange}
                  />
                )
              })}
            </Flex>
          </div>
        )}
      </Form>
    </Modal>
  )
}

interface TypeCheckboxItemProps {
  originalModelForChecker: Model
  currentTypeState: boolean | undefined
  typeKey: keyof ModelTypes
  label: string
  checker: (model: Model) => boolean
  onTypeChange: (typeKey: keyof ModelTypes, isChecked: boolean) => void
}

const TypeCheckboxItem: FC<TypeCheckboxItemProps> = ({
  originalModelForChecker,
  currentTypeState,
  typeKey,
  label,
  checker,
  onTypeChange
}) => {
  const { t } = useTranslation()

  const isChecked = typeof currentTypeState === 'boolean' ? currentTypeState : checker(originalModelForChecker)

  const handleChange = (newCheckedState: boolean) => {
    const isPotentiallyRiskyChange = newCheckedState && !checker(originalModelForChecker)

    if (isPotentiallyRiskyChange) {
      window.modal.confirm({
        title: t('settings.moresetting.warn'),
        content: t('settings.moresetting.check.warn'),
        okText: t('settings.moresetting.check.confirm'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        cancelButtonProps: { type: 'primary' },
        onOk: () => {
          onTypeChange(typeKey, newCheckedState)
        },
        onCancel: () => {},
        centered: true
      })
    } else {
      onTypeChange(typeKey, newCheckedState)
    }
  }

  return (
    <Checkbox checked={isChecked} onChange={(e) => handleChange(e.target.checked)}>
      {label}
    </Checkbox>
  )
}

const TypeTitle = styled.div`
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
`

const ExpandIcon = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

const MoreSettingsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-3);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background-color: var(--color-background-soft);
  }
`

export default ModelEditContent
