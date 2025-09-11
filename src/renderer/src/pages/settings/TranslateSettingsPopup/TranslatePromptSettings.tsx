import { RedoOutlined } from '@ant-design/icons'
import { usePreference } from '@data/hooks/usePreference'
import { RowFlex } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { TRANSLATE_PROMPT } from '@shared/config/prompts'
import { Input, Tooltip } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingGroup, SettingTitle } from '..'

const TranslatePromptSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [translateModelPrompt, setTranslateModelPrompt] = usePreference('feature.translate.model_prompt')

  const [localPrompt, setLocalPrompt] = useState(translateModelPrompt)

  const onResetTranslatePrompt = () => {
    setLocalPrompt(TRANSLATE_PROMPT)
    setTranslateModelPrompt(TRANSLATE_PROMPT)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ marginBottom: 12 }}>
        <RowFlex className="items-center">
          {t('settings.translate.prompt')}
          {localPrompt !== TRANSLATE_PROMPT && (
            <Tooltip title={t('common.reset')}>
              <ResetButton type="reset" onClick={onResetTranslatePrompt}>
                <RedoOutlined size={16} />
              </ResetButton>
            </Tooltip>
          )}
        </RowFlex>
      </SettingTitle>
      <Input.TextArea
        value={localPrompt}
        onChange={(e) => setLocalPrompt(e.target.value)}
        onBlur={(e) => setTranslateModelPrompt(e.target.value)}
        autoSize={{ minRows: 4, maxRows: 10 }}
        placeholder={t('settings.models.translate_model_prompt_message')}
      />
    </SettingGroup>
  )
}

const ResetButton = styled.button`
  background-color: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text);
  padding: 0;
  width: 30px;
  height: 30px;

  &:hover {
    background: var(--color-list-item);
    border-radius: 8px;
  }
`

export default TranslatePromptSettings
