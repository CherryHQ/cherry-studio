import { loggerService } from '@logger'
import EmojiPicker from '@renderer/components/EmojiPicker'
import InfoTooltip from '@renderer/components/InfoTooltip'
import useTranslate from '@renderer/hooks/useTranslate'
import { addCustomLanguage, updateCustomLanguage } from '@renderer/services/TranslateService'
import { CustomTranslateLanguage } from '@renderer/types'
import { Button, Form, Input, Modal, Popover, Space } from 'antd'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  isOpen: boolean
  editingCustomLanguage?: CustomTranslateLanguage
  onAdd: (item: CustomTranslateLanguage) => void
  onEdit: (item: CustomTranslateLanguage) => void
  onCancel: () => void
}

const logger = loggerService.withContext('CustomLanguageModal')

const CustomLanguageModal = ({ isOpen, editingCustomLanguage, onAdd, onEdit, onCancel }: Props) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  // antd表单的getFieldValue方法在首次渲染时无法获取到值，但emoji需要获取表单值来显示，所以单独管理状态
  const defaultEmoji = '🏳️'
  const [emoji, setEmoji] = useState(defaultEmoji)
  const { translateLanguages } = useTranslate()

  const langCodeList = useMemo(() => {
    return translateLanguages.map((item) => item.langCode)
  }, [translateLanguages])

  useEffect(() => {
    if (editingCustomLanguage) {
      form.setFieldsValue({
        emoji: editingCustomLanguage.emoji,
        value: editingCustomLanguage.value,
        langCode: editingCustomLanguage.langCode
      })
      setEmoji(editingCustomLanguage.emoji)
    } else {
      form.resetFields()
      setEmoji(defaultEmoji)
    }
  }, [editingCustomLanguage, isOpen, form])

  const title = useMemo(
    () => (editingCustomLanguage ? t('common.edit') : t('common.add')) + t('translate.custom.label'),
    [editingCustomLanguage, t]
  )

  const formItemLayout = {
    labelCol: { span: 8 },
    wrapperCol: { span: 16 }
  }

  const handleSubmit = useCallback(
    async (values: any) => {
      const { emoji, value, langCode } = values

      if (editingCustomLanguage) {
        try {
          await updateCustomLanguage(editingCustomLanguage, value, emoji, langCode)
          onEdit({ ...editingCustomLanguage, emoji, value, langCode })
          window.message.success(t('settings.translate.custom.success.update'))
        } catch (e) {
          window.message.error(t('settings.translate.custom.error.update') + ': ' + (e as Error).message)
        }
      } else {
        try {
          const added = await addCustomLanguage(value, emoji, langCode)
          onAdd(added)
          window.message.success(t('settings.translate.custom.success.add'))
        } catch (e) {
          window.message.error(t('settings.translate.custom.error.add') + ': ' + (e as Error).message)
        }
      }
      onCancel()
    },
    [editingCustomLanguage, onCancel, t, onEdit, onAdd]
  )

  const footer = useMemo(() => {
    return [
      <Button key="modal-cancel" onClick={onCancel}>
        {t('common.cancel')}
      </Button>,
      <Button key="modal-save" type="primary" onClick={form.submit}>
        {editingCustomLanguage ? t('common.save') : t('common.add')}
      </Button>
    ]
  }, [onCancel, t, form.submit, editingCustomLanguage])

  return (
    <Modal
      open={isOpen}
      title={title}
      footer={footer}
      onCancel={onCancel}
      maskClosable={false}
      forceRender
      styles={{
        body: {
          padding: '20px'
        }
      }}>
      <Form form={form} onFinish={handleSubmit} validateTrigger="onBlur" colon={false}>
        <Form.Item name="emoji" label="Emoji" {...formItemLayout} style={{ height: 32 }} initialValue={defaultEmoji}>
          <Popover
            content={
              <EmojiPicker
                onEmojiClick={(emoji) => {
                  form.setFieldsValue({ emoji })
                  setEmoji(emoji)
                }}
              />
            }
            arrow
            trigger="click">
            <Button style={{ aspectRatio: '1/1' }} icon={<Emoji emoji={emoji} />} />
          </Popover>
        </Form.Item>
        <Form.Item
          name="value"
          label={Label(t('settings.translate.custom.value.label'), t('settings.translate.custom.value.help'))}
          {...formItemLayout}
          initialValue={''}
          rules={[
            { required: true, message: t('settings.translate.custom.error.value.empty') },
            { max: 32, message: t('settings.translate.custom.error.value.too_long') }
          ]}>
          <Input placeholder={t('settings.translate.custom.value.placeholder')} />
        </Form.Item>
        <Form.Item
          name="langCode"
          label={Label(t('settings.translate.custom.langCode.label'), t('settings.translate.custom.langCode.help'))}
          {...formItemLayout}
          initialValue={''}
          rules={[
            { required: true, message: t('settings.translate.custom.error.langCode.empty') },
            {
              pattern: /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,3})?$/,
              message: t('settings.translate.custom.error.langCode.invalid')
            },
            {
              validator: async (_, value: string) => {
                logger.silly('validate langCode', { value, langCodeList, editingCustomLanguage })
                if (editingCustomLanguage) {
                  if (langCodeList.includes(value) && value !== editingCustomLanguage.langCode) {
                    throw new Error(t('settings.translate.custom.error.langCode.exists'))
                  }
                } else {
                  const langCode = value.toLowerCase()
                  if (langCodeList.includes(langCode)) {
                    throw new Error(t('settings.translate.custom.error.langCode.exists'))
                  }
                }
              }
            }
          ]}>
          <Input placeholder={t('settings.translate.custom.langCode.placeholder')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const Label = (label: string, help: string) => {
  return (
    <Space>
      <span>{label}</span>
      <InfoTooltip title={help} />
    </Space>
  )
}

const Emoji: FC<{ emoji: string; size?: number }> = ({ emoji, size = 18 }) => {
  return <div style={{ lineHeight: 0, fontSize: size }}>{emoji}</div>
}

export default CustomLanguageModal
