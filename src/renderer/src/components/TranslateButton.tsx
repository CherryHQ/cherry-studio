import { LoadingOutlined } from '@ant-design/icons'
import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useLanguages } from '@renderer/hooks/translate/useLanguages'
import { translateText } from '@renderer/services/TranslateService'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
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
  const [targetLanguage] = usePreference('feature.translate.chat.target_language')
  const [showTranslateConfirm] = usePreference('feature.translate.chat.show_confirm')
  const { getLabel, languages } = useLanguages()

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
      // We already loaded the languages list via useLanguages — pass the VO
      // directly so translateText doesn't have to round-trip GET /translate/languages/:code.
      // Fall back to the lang code string if the list hasn't resolved yet,
      // letting translateText's own fetch path handle it.
      const targetVo = languages?.find((l) => l.langCode === targetLanguage)
      const translatedText = await translateText(text, targetVo ?? targetLanguage)
      onTranslated(translatedText)
    } catch (error) {
      logger.error('Translation failed:', error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
    } finally {
      setIsTranslating(false)
    }
  }

  useEffect(() => {
    setIsTranslating(isLoading ?? false)
  }, [isLoading])

  return (
    <Tooltip content={t('chat.input.translate', { target_language: getLabel(targetLanguage, false) })}>
      <Button
        onClick={handleTranslate}
        disabled={disabled || isTranslating}
        style={style}
        variant="ghost"
        size="icon-sm"
        className="rounded-full">
        {isTranslating ? <LoadingOutlined spin /> : <Languages size={18} />}
      </Button>
    </Tooltip>
  )
}

export default TranslateButton
