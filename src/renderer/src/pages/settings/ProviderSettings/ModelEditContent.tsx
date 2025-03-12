import { DownOutlined, UpOutlined } from '@ant-design/icons'
import { isEmbeddingModel, isFunctionCallingModel, isReasoningModel, isVisionModel } from '@renderer/config/models'
import { Model, ModelType } from '@renderer/types'
import { getDefaultGroupName } from '@renderer/utils'
import { Button, Checkbox, Divider, Flex, Form, Input, Modal } from 'antd'
import { FC, useState } from 'react'
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
  const onFinish = (values: any) => {
    const updatedModel = {
      ...model,
      id: values.id || model.id,
      name: values.name || model.name,
      group: values.group || model.group
    }
    onUpdateModel(updatedModel)
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
        initialValues={{
          id: model.id,
          name: model.name,
          group: model.group
        }}
        onFinish={onFinish}>
        <Form.Item
          name="id"
          label={t('settings.models.add.model_id')}
          tooltip={t('settings.models.add.model_id.tooltip')}
          rules={[{ required: true }]}>
          <Input
            placeholder={t('settings.models.add.model_id.placeholder')}
            spellCheck={false}
            maxLength={200}
            disabled={true}
            onChange={(e) => {
              const value = e.target.value
              form.setFieldValue('name', value)
              form.setFieldValue('group', getDefaultGroupName(value))
            }}
          />
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
          <Flex justify="center" align="center" style={{ position: 'relative' }}>
            <div>
              <Button type="primary" htmlType="submit" size="middle">
                {t('common.save')}
              </Button>
            </div>
            <MoreSettingsRow
              onClick={() => setShowModelTypes(!showModelTypes)}
              style={{ position: 'absolute', right: 0 }}>
              {t('settings.moresetting')}
              <ExpandIcon>{showModelTypes ? <UpOutlined /> : <DownOutlined />}</ExpandIcon>
            </MoreSettingsRow>
          </Flex>
        </Form.Item>
        {showModelTypes && (
          <div>
            <Divider style={{ margin: '0 0 15px 0' }} />
            <TypeTitle>{t('models.type.select')}:</TypeTitle>
            {(() => {
              const defaultTypes = [
                ...(isVisionModel(model) ? ['vision'] : []),
                ...(isEmbeddingModel(model) ? ['embedding'] : []),
                ...(isReasoningModel(model) ? ['reasoning'] : []),
                ...(isFunctionCallingModel(model) ? ['tools'] : [])
              ] as ModelType[]

              // 合并现有选择和默认类型
              const selectedTypes = [...new Set([...(model.type || []), ...defaultTypes])]

              const showTypeConfirmModal = (type: string) => {
                window.modal.confirm({
                  title: t('settings.moresetting.warn'),
                  content: t('settings.moresetting.check.warn'),
                  okText: t('settings.moresetting.check.confirm'),
                  cancelText: t('common.cancel'),
                  okButtonProps: { danger: true },
                  cancelButtonProps: { type: 'primary' },
                  onOk: () => onUpdateModel({ ...model, type: [...selectedTypes, type] as ModelType[] }),
                  onCancel: () => {},
                  centered: true
                })
              }

              const handleTypeChange = (types: string[]) => {
                const newType = types.find((type) => !selectedTypes.includes(type as ModelType))

                if (newType) {
                  showTypeConfirmModal(newType)
                } else {
                  onUpdateModel({ ...model, type: types as ModelType[] })
                }
              }

              return (
                <Checkbox.Group
                  value={selectedTypes}
                  onChange={handleTypeChange}
                  options={[
                    {
                      label: t('models.type.vision'),
                      value: 'vision',
                      disabled: isVisionModel(model) && !selectedTypes.includes('vision')
                    },
                    {
                      label: t('models.type.embedding'),
                      value: 'embedding',
                      disabled: isEmbeddingModel(model) && !selectedTypes.includes('embedding')
                    },
                    {
                      label: t('models.type.reasoning'),
                      value: 'reasoning',
                      disabled: isReasoningModel(model) && !selectedTypes.includes('reasoning')
                    },
                    {
                      label: t('models.type.function_calling'),
                      value: 'function_calling',
                      disabled: isFunctionCallingModel(model) && !selectedTypes.includes('function_calling')
                    }
                  ]}
                />
              )
            })()}
          </div>
        )}
      </Form>
    </Modal>
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
