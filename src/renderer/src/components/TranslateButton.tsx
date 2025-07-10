import { LoadingOutlined } from '@ant-design/icons'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { getLanguageByLangcode } from '@renderer/utils/translate'
import { Button, Tooltip } from 'antd'
import { Languages } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  text?: string
  onTranslated: (translatedText: string) => void
  disabled?: boolean
  style?: React.CSSProperties
  isLoading?: boolean
}

const TranslateButton: FC<Props> = ({ text, onTranslated, disabled, style, isLoading }) => {
  const { t } = useTranslation()
  const { translateModel } = useDefaultModel()
  const [isTranslating, setIsTranslating] = useState(false)
  const { targetLanguage, showTranslateConfirm } = useSettings()

  const translateConfirm = () => {
    if (!showTranslateConfirm) {
      return Promise.resolve(true)
    }
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
      const assistant = getDefaultTranslateAssistant(getLanguageByLangcode(targetLanguage), text)
      const translatedText = await fetchTranslate({ content: text, assistant })
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
      title={t('chat.input.translate', { target_language: getLanguageByLangcode(targetLanguage).label() })}
      mouseLeaveDelay={0}
      arrow>
      <ToolbarButton onClick={handleTranslate} disabled={disabled || isTranslating} style={style} type="text">
        {isTranslating ? <LoadingOutlined spin /> : <Languages size={18} />}
      </ToolbarButton>
    </Tooltip>
  )
}

const ToolbarButton = styled(Button)`
  min-width: 30px;
  height: 30px;
  font-size: 16px;
  border-radius: 50%;
  transition: all 0.3s ease;
  color: var(--color-icon);
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 0;
  &.anticon,
  &.iconfont {
    transition: all 0.3s ease;
    color: var(--color-icon);
  }
  &:hover {
    background-color: var(--color-background-soft);
    .anticon,
    .iconfont {
      color: var(--color-text-1);
    }
  }
  &.active {
    background-color: var(--color-primary) !important;
    .anticon,
    .iconfont {
      color: var(--color-white-soft);
    }
    &:hover {
      background-color: var(--color-primary);
    }
  }
`

export default TranslateButton
