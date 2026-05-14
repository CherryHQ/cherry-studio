import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useLanguages } from '@renderer/hooks/translate/useTranslateLanguages'
import { translateInputText } from '@renderer/services/TranslateCommandService'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { Languages, Loader2 } from 'lucide-react'
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
  const [targetLanguage] = usePreference('chat.input.translate.target_language')
  const [showTranslateConfirm] = usePreference('chat.input.translate.show_confirm')
  const { getLabel, languages } = useLanguages()

  const handleTranslate = async () => {
    if (!text?.trim()) return

    try {
      const translatedText = await translateInputText({
        text,
        targetLanguage,
        languages,
        showConfirm: showTranslateConfirm,
        t,
        onConfirmed: () => setIsTranslating(true)
      })
      if (translatedText) {
        onTranslated(translatedText)
      }
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
        {isTranslating ? <Loader2 size={18} className="animate-spin" /> : <Languages size={18} />}
      </Button>
    </Tooltip>
  )
}

export default TranslateButton
