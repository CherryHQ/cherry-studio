import { DownOutlined, UpOutlined } from '@ant-design/icons'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { TopView } from '@renderer/components/TopView'
import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import { useProvider } from '@renderer/hooks/useProvider'
import { Model, ModelType } from '@renderer/types'
import { getDefaultGroupName } from '@renderer/utils'
import { Button, Checkbox, Divider, Flex, Form, Input, message, Modal } from 'antd'
import { CheckboxProps } from 'antd/lib/checkbox'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ModelEditPopupProps {
  model: Model
  resolve: (updatedModel?: Model) => void
}

const PopupContainer: FC<ModelEditPopupProps> = ({ model, resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const [showModelTypes, setShowModelTypes] = useState(false)
  const { updateModel } = useProvider(model.provider)

  const onFinish = (values: any) => {
    const updatedModel = {
      ...model,
      id: values.id || model.id,
      name: values.name || model.name,
      group: values.group || model.group
    }
    updateModel(updatedModel)
    setShowModelTypes(false)
    setOpen(false)
    resolve(updatedModel)
  }

  const handleClose = () => {
    setShowModelTypes(false)
    setOpen(false)
    resolve()
  }

  const onUpdateModel = (updatedModel: Model) => {
    updateModel(updatedModel)
    // 只更新模型数据，不关闭弹窗，不返回结果
  }

  return (
    <Modal
      title={t('models.edit')}
      open={open}
      onCancel={handleClose}
      footer={null}
      maskClosable={false}
      centered
      width={600} // 增加宽度
      styles={{
        content: {
          padding: '20px', // 增加内边距
          borderRadius: 15 // 增加圆角
        }
      }}
      afterOpenChange={(visible) => {
        if (visible) {
          form.getFieldInstance('id')?.focus()
        } else {
          setShowModelTypes(false)
        }
      }}>
      <Form
        form={form}
        labelCol={{ flex: '120px' }} // 增加标签宽度
        labelAlign="left"
        colon={false}
        style={{ marginTop: 15 }}
        size="large" // 使表单控件更大
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
              type="text"
              icon={<CopyIcon />}
              onClick={() => {
                navigator.clipboard.writeText(model.id)
                message.success(t('message.copy.success'))
              }}
            />
          </Flex>
        </Form.Item>
        <Form.Item
          name="name"
          label={t('settings.models.add.model_name')}
          tooltip={t('settings.models.add.model_name.tooltip')}
          rules={[{ required: true }]}>
          <Input placeholder={t('settings.models.add.model_name.placeholder')} spellCheck={false} maxLength={200} />
        </Form.Item>
        <Form.Item
          name="group"
          label={t('settings.models.add.model_group')}
          tooltip={t('settings.models.add.model_group.tooltip')}>
          <Input placeholder={t('settings.models.add.model_group.placeholder')} spellCheck={false} maxLength={200} />
        </Form.Item>
        <Form.Item style={{ marginBottom: 20, textAlign: 'center', marginTop: 10 }}>
          <Flex justify="space-between" align="center" style={{ position: 'relative' }}>
            <MoreSettingsRow onClick={() => setShowModelTypes(!showModelTypes)}>
              {t('settings.moresetting')}
              <ExpandIcon>{showModelTypes ? <UpOutlined /> : <DownOutlined />}</ExpandIcon>
            </MoreSettingsRow>
            <Button type="primary" htmlType="submit" size="large">
              {t('common.save')}
            </Button>
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
                ...(isFunctionCallingModel(model) ? ['function_calling'] : []),
                ...(isWebSearchModel(model) ? ['web_search'] : [])
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
                  onOk: () => {
                    const updatedModel = { ...model, type: [...selectedTypes, type] as ModelType[] }
                    onUpdateModel(updatedModel)
                  },
                  onCancel: () => {},
                  centered: true
                })
              }

              const handleTypeChange = (types: string[]) => {
                const newType = types.find((type) => !selectedTypes.includes(type as ModelType))

                if (newType) {
                  // 如果有新类型被添加，显示确认对话框
                  showTypeConfirmModal(newType)
                } else {
                  // 如果没有新类型，只是取消选择了某些类型，直接更新
                  const updatedModel = { ...model, type: types as ModelType[] }
                  onUpdateModel(updatedModel)
                }
              }

              return (
                <Checkbox.Group
                  value={selectedTypes}
                  onChange={handleTypeChange}
                  style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                  <StyledCheckbox value="vision">{t('models.type.vision')}</StyledCheckbox>
                  <StyledCheckbox value="web_search">{t('models.type.websearch')}</StyledCheckbox>
                  <StyledCheckbox value="reasoning">{t('models.type.reasoning')}</StyledCheckbox>
                  <StyledCheckbox value="function_calling">{t('models.type.function_calling')}</StyledCheckbox>
                  <StyledCheckbox value="embedding">{t('models.type.embedding')}</StyledCheckbox>
                  <StyledCheckbox value="rerank">{t('models.type.rerank')}</StyledCheckbox>
                </Checkbox.Group>
              )
            })()}
          </div>
        )}
      </Form>
    </Modal>
  )
}

const MoreSettingsRow = styled.div`
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px; // 增加间距
  color: var(--color-text-secondary);
  font-size: 14px; // 增加字体大小
  &:hover {
    color: var(--color-text-primary);
  }
`

const ExpandIcon = styled.span`
  font-size: 12px; // 增加图标大小
  display: flex;
  align-items: center;
`

const TypeTitle = styled.div`
  font-size: 16px; // 增加字体大小
  margin-bottom: 15px; // 增加下边距
  font-weight: 500;
`

const StyledCheckbox = styled(Checkbox)<CheckboxProps>`
  font-size: 14px; // 增加字体大小
  padding: 5px 0; // 增加内边距

  .ant-checkbox-inner {
    width: 18px; // 增加复选框大小
    height: 18px; // 增加复选框大小
  }

  .ant-checkbox + span {
    padding-left: 12px; // 增加文字与复选框的间距
  }
`

export default class ModelEditPopup {
  static hide() {
    TopView.hide('ModelEditPopup')
  }
  static show(model: Model) {
    return new Promise<Model | undefined>((resolve) => {
      TopView.show(<PopupContainer model={model} resolve={resolve} />, 'ModelEditPopup')
    })
  }
}
