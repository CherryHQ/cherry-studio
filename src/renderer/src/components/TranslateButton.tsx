import { LoadingOutlined } from '@ant-design/icons'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTopic, getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { getUserMessage } from '@renderer/services/MessagesService'
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
  ToolbarButton?: typeof Button
}

const TranslateButton: FC<Props> = ({
  text,
  onTranslated,
  disabled = false,
  style,
  isLoading,
  ToolbarButton = DefaultToolbarButton
}) => {
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
      <ToolbarButton
        onClick={handleTranslate}
        disabled={disabled || isTranslating}
        className={disabled || isTranslating ? 'disabled' : ''}
        style={style}
        type="text">
        {isTranslating ? <LoadingOutlined spin /> : <Languages size={18} />}
      </ToolbarButton>
    </Tooltip>
  )
}

export default TranslateButton

const DefaultToolbarButton = styled(Button)`
  width: 30px;
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
  .icon-a-addchat {
    font-size: 18px;
    margin-bottom: -2px;
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
  &.disabled {
    color: var(--color-text-3);
    cursor: default;
    &:hover {
      background-color: transparent;
      .anticon,
      .iconfont {
        color: var(--color-text-3);
      }
    }
  }
`
