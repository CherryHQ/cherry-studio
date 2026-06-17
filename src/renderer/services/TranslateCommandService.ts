import { translateText } from '@renderer/services/TranslateService'
import type { TranslateLangCode, TranslateLanguage } from '@renderer/types'
import type { TFunction } from 'i18next'

interface TranslateInputTextOptions {
  text: string
  targetLanguage: TranslateLangCode
  languages?: TranslateLanguage[]
  showConfirm?: boolean
  copySourceToClipboard?: boolean
  t: TFunction
  onConfirmed?: () => void
}

export const translateInputText = async ({
  text,
  targetLanguage,
  languages,
  showConfirm = false,
  copySourceToClipboard = true,
  t,
  onConfirmed
}: TranslateInputTextOptions): Promise<string | null> => {
  if (!text.trim()) return null

  if (showConfirm) {
    const confirmed = await window.modal.confirm({
      title: t('translate.confirm.title'),
      content: t('translate.confirm.content'),
      centered: true
    })
    if (!confirmed) return null
  }

  onConfirmed?.()

  if (copySourceToClipboard) {
    await navigator.clipboard.writeText(text)
  }

  const language = languages?.find((item) => item.langCode === targetLanguage) ?? targetLanguage
  return translateText(text, language)
}
