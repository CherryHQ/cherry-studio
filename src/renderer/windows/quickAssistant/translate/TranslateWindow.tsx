import { Scrollbar } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import LanguageSelect from '@renderer/components/LanguageSelect'
import { useTranslate } from '@renderer/hooks/translate'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { isEmpty } from 'lodash'
import { ArrowLeftRight } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

interface Props {
  text: string
}

const Translate: FC<Props> = ({ text }) => {
  const [result, setResult] = useState('')
  const [targetLanguage, setTargetLanguage] = usePreference('feature.translate.mini_window.target_lang')
  const { translateModel } = useDefaultModel()
  const { t } = useTranslation()
  const { translate: runTranslate, isTranslating } = useTranslate({
    loggerContext: 'TranslateWindow',
    onResponse: setResult
  })

  const translate = useCallback(async () => {
    if (!text.trim() || !translateModel) return
    if (isTranslating) return
    await runTranslate(text, targetLanguage)
  }, [text, targetLanguage, translateModel, isTranslating, runTranslate])

  useEffect(() => {
    void translate()
  }, [translate])

  useHotkeys('c', () => {
    void navigator.clipboard.writeText(result)
    window.toast.success(t('message.copy.success'))
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-3 [-webkit-app-region:no-drag]">
      <div className="mb-4 flex w-full flex-row items-center justify-center gap-5">
        <div className="flex h-9 min-w-25 flex-1 items-center rounded-md border border-input bg-muted px-3 text-foreground-muted text-sm opacity-70">
          <span className="truncate">{t('translate.any.language')}</span>
        </div>
        <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" />
        <LanguageSelect
          showSearch
          value={targetLanguage}
          className="min-w-32.5 flex-1"
          optionFilterProp="label"
          onChange={async (value) => {
            return await setTargetLanguage(value)
          }}
        />
      </div>
      <div className="flex w-full flex-1 overflow-hidden">
        {isEmpty(result) ? (
          <div className="text-foreground-muted italic">{t('translate.output.placeholder')}...</div>
        ) : (
          <Scrollbar className="flex flex-1 flex-col gap-2.5">
            <div className="w-full whitespace-pre-wrap break-words">{result}</div>
          </Scrollbar>
        )}
      </div>
    </div>
  )
}

export default Translate
