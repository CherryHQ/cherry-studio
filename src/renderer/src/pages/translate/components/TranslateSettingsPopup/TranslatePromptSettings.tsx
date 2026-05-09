import { RedoOutlined } from '@ant-design/icons'
import { Textarea, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SettingSubtitle } from '@renderer/pages/settings'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const TranslatePromptSettings = () => {
  const { t } = useTranslation()
  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')

  const [localPrompt, setLocalPrompt] = useState(translateModelPrompt)

  const onResetTranslatePrompt = () => {
    setLocalPrompt(TRANSLATE_PROMPT)
    void setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  return (
    <section className="space-y-2">
      <SettingSubtitle className="mt-0 flex h-[30px] items-center justify-between text-(--color-foreground)">
        <span className="font-bold text-(--color-foreground)">{t('settings.translate.prompt')}</span>
        {localPrompt !== TRANSLATE_PROMPT && (
          <Tooltip content={t('common.reset')}>
            <button
              type="reset"
              className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border-none bg-transparent p-0 text-foreground transition-colors hover:bg-accent"
              onClick={onResetTranslatePrompt}>
              <RedoOutlined size={16} />
            </button>
          </Tooltip>
        )}
      </SettingSubtitle>
      <Textarea.Input
        value={localPrompt}
        onChange={(e) => setLocalPrompt(e.target.value)}
        onBlur={(e) => void setTranslateModelPrompt(e.target.value)}
        rows={4}
        className="max-h-60 min-h-24 text-foreground text-sm leading-5"
        placeholder={t('settings.models.translate_model_prompt_message')}
      />
    </section>
  )
}

export default TranslatePromptSettings
