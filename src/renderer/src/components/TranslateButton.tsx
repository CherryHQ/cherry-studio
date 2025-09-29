import { LoadingOutlined } from '@ant-design/icons'
import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import useTranslate from '@renderer/hooks/useTranslate'
import { translateText } from '@renderer/services/TranslateService'
import { Languages } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  text?: string
  onTranslated: (translatedText: string) => void
  disabled?: boolean
  style?: React.CSSProperties
  isLoading?: boolean
}

const logger = loggerService.withContext('TranslateButton')

const TranslateButton: FC<Props> = ({ text, onTranslated, disabled, style, isLoading }) => {
  const { t } = useTranslation()
  const [isTranslating, setIsTranslating] = useState(false)
  const [targetLanguage] = usePreference('feature.translate.target_language')
  const [showTranslateConfirm] = usePreference('chat.input.translate.show_confirm')
  const { getLanguageByLangcode } = useTranslate()

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

    // 先复制原文到剪贴板
    await navigator.clipboard.writeText(text)

    setIsTranslating(true)
    try {
      const translatedText = await translateText(text, getLanguageByLangcode(targetLanguage))
      onTranslated(translatedText)
    } catch (error) {
      logger.error('Translation failed:', error as Error)
      window.toast.error(t('translate.error.failed'))
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
      content={t('chat.input.translate', { target_language: getLanguageByLangcode(targetLanguage).label() })}>
      <Button
        onPress={handleTranslate}
        isDisabled={disabled || isTranslating}
        style={style}
        variant="light"
        isIconOnly
        size="sm"
        radius="full">
        {isTranslating ? <LoadingOutlined spin /> : <Languages size={18} />}
      </Button>
    </Tooltip>
  )
}

export default TranslateButton
