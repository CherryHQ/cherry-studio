import { RedoOutlined } from '@ant-design/icons'
import { RowFlex, Textarea, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingGroup, SettingTitle } from '..'

const TranslatePromptSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')

  const [localPrompt, setLocalPrompt] = useState(translateModelPrompt)

  const onResetTranslatePrompt = () => {
    setLocalPrompt(TRANSLATE_PROMPT)
    void setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ marginBottom: 12 }}>
        <RowFlex className="h-[30px] items-center gap-2.5">
          {t('settings.translate.prompt')}
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
        </RowFlex>
      </SettingTitle>
      <Textarea.Input
        value={localPrompt}
        onChange={(e) => setLocalPrompt(e.target.value)}
        onBlur={(e) => void setTranslateModelPrompt(e.target.value)}
        rows={4}
        className="max-h-60 min-h-24"
        placeholder={t('settings.models.translate_model_prompt_message')}
      />
    </SettingGroup>
  )
}

export default TranslatePromptSettings
