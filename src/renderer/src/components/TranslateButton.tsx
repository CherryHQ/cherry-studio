import { LoadingOutlined, TranslationOutlined } from '@ant-design/icons'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTopic, getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { getUserMessage } from '@renderer/services/MessagesService'
import { Tooltip } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  text?: string
  onTranslated: (translatedText: string) => void
  disabled?: boolean
  style?: React.CSSProperties
  isLoading?: boolean
  ToolbarButton: any
}

const TranslateButton: FC<Props> = ({ text, onTranslated, disabled, style, isLoading, ToolbarButton }) => {
  const { t } = useTranslation()
  const { translateModel } = useDefaultModel()
  const [isTranslating, setIsTranslating] = useState(false)
  const { targetLanguage } = useSettings()

  const translateConfirm = () => {
    return window?.modal?.confirm({
      title: t('translate.confirm.title'),
      content: t('translate.confirm.content'),
      centered: true
    })
  }

  const handleTranslate = async () => {
    if (!text?.trim()) return

    if (!(await translateConfirm())) {
      return
    }

    if (!translateModel) {
      window.message.error({
        content: t('translate.error.not_configured'),
        key: 'translate-message'
      })
      return
    }

    // 先复制原文到剪贴板
    await navigator.clipboard.writeText(text)

    setIsTranslating(true)
    try {
      const assistant = getDefaultTranslateAssistant(targetLanguage, text)
      const message = getUserMessage({
        assistant,
        topic: getDefaultTopic('default'),
        type: 'text',
        content: ''
      })

      const translatedText = await fetchTranslate({ message, assistant })
      onTranslated(translatedText)
    } catch (error) {
      console.error('Translation failed:', error)
      window.message.error({
        content: t('translate.error.failed'),
        key: 'translate-message'
      })
    } finally {
      setIsTranslating(false)
    }
  }

  useEffect(() => {
    setIsTranslating(isLoading ?? false)
  }, [isLoading])

  return (
    <Tooltip
      placement="top"
      title={t('chat.input.translate', { target_language: t(`languages.${targetLanguage.toString()}`) })}
      arrow>
      <ToolbarButton onClick={handleTranslate} disabled={disabled || isTranslating} style={style} type="text">
        {isTranslating ? <LoadingOutlined spin /> : <TranslationOutlined />}
      </ToolbarButton>
    </Tooltip>
  )
}

export default TranslateButton
