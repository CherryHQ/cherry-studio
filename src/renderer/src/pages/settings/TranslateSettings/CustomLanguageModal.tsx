import EmojiPicker from '@renderer/components/EmojiPicker'
import { HStack } from '@renderer/components/Layout'
import { builtinLangCodeList } from '@renderer/config/translate'
import { loggerService } from '@renderer/services/LoggerService'
import { addCustomLanguage, updateCustomLanguage } from '@renderer/services/TranslateService'
import { CustomTranslateLanguage } from '@renderer/types'
import { Button, Input, Modal, Popover } from 'antd'
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
  const [emoji, setEmoji] = useState(editingCustomLanguage?.emoji ?? '')
  const [value, setValue] = useState(editingCustomLanguage?.value ?? '')
  const [langCode, setLangCode] = useState(editingCustomLanguage?.langCode ?? '')

  const title = useMemo(
    () => (editingCustomLanguage ? t('common.edit') : t('common.add')) + t('translate.custom.label'),
    [editingCustomLanguage, t]
  )

  const innerCancel = useCallback(() => {
    onCancel()
    clearState()
  }, [onCancel])

  // 基本校验 规则暂时硬编码
  const checkBeforeSubmit = useCallback((): boolean => {
    logger.debug(`checkBeforeSubmit`)
    if (isEmpty(value)) {
      window.message.error(t('settings.translate.custom.error.value.empty'))
      return false
    }
    if (value.length > 32) {
      window.message.error(t('settings.translate.custom.error.value.too_long'))
      return false
    }
    logger.debug(`checking ${langCode}, result is ${isEmpty(langCode)}`)
    if (!/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,3})?$/.test(langCode) || isEmpty(langCode)) {
      window.message.error(t('settings.translate.custom.error.langCode.invalid'))
      return false
    }
    if (builtinLangCodeList.includes(langCode.toLowerCase())) {
      window.message.error(t('settings.translate.custom.error.langCode.builtin'))
      return false
    }
    return true
  }, [langCode, t, value])

  const handleSubmit = useCallback(async () => {
    if (!checkBeforeSubmit()) {
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
    innerCancel()
  }, [checkBeforeSubmit, editingCustomLanguage, emoji, innerCancel, langCode, onAdd, onEdit, t, value])

  const footer = useMemo(() => {
    return [
      <Button key="modal-cancel" onClick={innerCancel}>
        {t('common.cancel')}
      </Button>,
      <Button key="modal-save" type="primary" onClick={handleSubmit}>
        {editingCustomLanguage ? t('common.save') : t('common.add')}
      </Button>
    ]
  }, [editingCustomLanguage, handleSubmit, innerCancel, t])

  const clearState = () => {
    // 清空所有状态
    setValue('')
    setLangCode('')
    setEmoji('')
  }

  useEffect(() => {
    setValue(editingCustomLanguage?.value ?? '')
    setLangCode(editingCustomLanguage?.langCode ?? '')
    setEmoji(editingCustomLanguage?.emoji ?? '')
  }, [editingCustomLanguage, isOpen])

  return (
    <Modal open={isOpen} title={title} footer={footer} onCancel={innerCancel}>
      <HStack alignItems="center" gap={4}>
        <Popover content={<EmojiPicker onEmojiClick={setEmoji} />} arrow trigger="click">
          <ButtonContainer>
            <Button style={{ aspectRatio: '1/1' }} icon={<Emoji emoji={emoji} />}></Button>
          </ButtonContainer>
        </Popover>
        <InputContainer>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('settings.translate.custom.value.placeholder')}
          />
        </InputContainer>
        <InputContainer>
          <Input
            value={langCode}
            onChange={(e) => setLangCode(e.target.value)}
            placeholder={t('settings.translate.custom.langCode.placeholder')}
          />
        </InputContainer>
      </HStack>
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
