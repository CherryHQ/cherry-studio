import { loggerService } from '@logger'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { HStack } from '@renderer/components/Layout'
import { builtinLangCodeList } from '@renderer/config/translate'
import { addCustomLanguage, updateCustomLanguage } from '@renderer/services/TranslateService'
import { CustomTranslateLanguage } from '@renderer/types'
import { Button, Form, Input, Modal, Popover } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

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
  // 表单无法同步显示emoji，会出现显示的emoji和表单中实际emoji不一致的情况，所以需要单独管理
  const defaultEmoji = '🏳️'
  const [emoji, setEmoji] = useState(defaultEmoji)

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

  const handleSubmit = useCallback(
    async (values: any) => {
      const { emoji, value, langCode } = values

      // 基本校验 规则暂时硬编码
      logger.debug(`checkBeforeSubmit`, {
        emoji,
        value,
        langCode
      })
      if (isEmpty(value)) {
        window.message.error(t('settings.translate.custom.error.value.empty'))
        return
      }
      if (value.length > 32) {
        window.message.error(t('settings.translate.custom.error.value.too_long'))
        return
      }
      logger.debug(`checking ${langCode}, result is ${isEmpty(langCode)}`)
      if (!/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,3})?$/.test(langCode) || isEmpty(langCode)) {
        window.message.error(t('settings.translate.custom.error.langCode.invalid'))
        return
      }
      if (builtinLangCodeList.includes(langCode.toLowerCase())) {
        window.message.error(t('settings.translate.custom.error.langCode.builtin'))
        return
      }

      if (editingCustomLanguage) {
        try {
          await updateCustomLanguage(editingCustomLanguage, value, emoji, langCode)
          onEdit({ ...editingCustomLanguage, emoji, value, langCode })
          window.message.success(t('settings.translate.custom.success.update'))
        } catch (e) {
          window.message.error(t('settings.translate.custom.error.update'))
        }
      } else {
        try {
          const added = await addCustomLanguage(value, emoji, langCode)
          onAdd(added)
          window.message.success(t('settings.translate.custom.success.add'))
        } catch (e) {
          window.message.error(t('settings.translate.custom.error.add'))
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
    <Modal open={isOpen} title={title} footer={footer} onCancel={onCancel}>
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <HStack alignItems="center" gap={4}>
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
            <ButtonContainer>
              <Form.Item name="emoji" noStyle>
                <Button style={{ aspectRatio: '1/1' }} icon={<Emoji emoji={emoji} />} />
              </Form.Item>
            </ButtonContainer>
          </Popover>
          <InputContainer>
            <Form.Item name="value" noStyle>
              <Input placeholder={t('settings.translate.custom.value.placeholder')} />
            </Form.Item>
          </InputContainer>
          <InputContainer>
            <Form.Item name="langCode" noStyle>
              <Input placeholder={t('settings.translate.custom.langCode.placeholder')} />
            </Form.Item>
          </InputContainer>
        </HStack>
      </Form>
    </Modal>
  )
}

const Emoji: FC<{ emoji: string; size?: number }> = ({ emoji, size = 18 }) => {
  return <div style={{ lineHeight: 0, fontSize: size }}>{emoji}</div>
}

const InputContainer = styled.div`
  flex: 1;
`

const ButtonContainer = styled.div`
  padding: 4px;
`

export default CustomLanguageModal
