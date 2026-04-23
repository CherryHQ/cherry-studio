import { Button, InfoTooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { useAddLanguage, useUpdateLanguage } from '@renderer/hooks/translate'
import { useLanguages } from '@renderer/hooks/translate/useLanguages'
import type { TranslateLanguageVo } from '@renderer/types'
import { Form, Input, Modal, Popover, Space } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  isOpen: boolean
  editingLanguage?: TranslateLanguageVo
  onCancel: () => void
}

const logger = loggerService.withContext('CustomLanguageModal')

const TranslateLanguagesModal = ({ isOpen, editingLanguage: editingCustomLanguage, onCancel }: Props) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  // antd表单的getFieldValue方法在首次渲染时无法获取到值，但emoji需要获取表单值来显示，所以单独管理状态
  const defaultEmoji = '🏳️'
  const [emoji, setEmoji] = useState(defaultEmoji)
  const { languages } = useLanguages()
  const addLanguage = useAddLanguage()
  const updateLanguage = useUpdateLanguage(editingCustomLanguage?.langCode ?? '')

  const langCodeList = useMemo(() => {
    return languages?.map((item) => item.langCode) ?? []
  }, [languages])

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
      try {
        if (editingCustomLanguage) {
          await updateLanguage({ value, emoji })
        } else {
          await addLanguage({ value, emoji, langCode })
        }
        onCancel() // Only close the modal on success — failures keep the form state so the user can retry.
      } catch {
        // Hooks already log + show error toast; swallow here to keep the modal open.
      }
    },
    [addLanguage, updateLanguage, editingCustomLanguage, onCancel]
  )

  const footer = useMemo(() => {
    return [
      <Button key="modal-cancel" onClick={onCancel}>
        {t('common.cancel')}
      </Button>,
      <Button key="modal-save" onClick={form.submit}>
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
      transitionName="animation-move-down"
      forceRender
      centered
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
            <Button type="button" style={{ aspectRatio: '1/1' }} size="icon">
              <Emoji emoji={emoji} />
            </Button>
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
          <Input
            disabled={editingCustomLanguage !== undefined}
            placeholder={t('settings.translate.custom.langCode.placeholder')}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const Label = (label: string, help: string) => {
  return (
    <Space>
      <span>{label}</span>
      <InfoTooltip content={help} />
    </Space>
  )
}

const Emoji: FC<{ emoji: string; size?: number }> = ({ emoji, size = 18 }) => {
  return <div style={{ lineHeight: 0, fontSize: size }}>{emoji}</div>
}

export default TranslateLanguagesModal
