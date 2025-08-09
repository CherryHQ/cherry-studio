import { RedoOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setTranslateModelPrompt } from '@renderer/store/settings'
import { Input, Tooltip } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingGroup, SettingTitle } from '..'

const TranslatePromptSettings = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { translateModelPrompt } = useSettings()

  const [localPrompt, setLocalPrompt] = useState(translateModelPrompt)

  const dispatch = useAppDispatch()

  const onResetTranslatePrompt = () => {
    setLocalPrompt(TRANSLATE_PROMPT)
    dispatch(setTranslateModelPrompt(TRANSLATE_PROMPT))
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle style={{ marginBottom: 12 }}>
        <HStack alignItems="center" gap={10} height={30}>
          {t('settings.translate.prompt')}
          {localPrompt !== TRANSLATE_PROMPT && (
            <Tooltip title={t('common.reset')}>
              <ResetButton type="reset" onClick={onResetTranslatePrompt}>
                <RedoOutlined size={16} />
              </ResetButton>
            </Tooltip>
          )}
        </HStack>
      </SettingTitle>
      <Input.TextArea
        value={localPrompt}
        onChange={(e) => setLocalPrompt(e.target.value)}
        onBlur={(e) => dispatch(setTranslateModelPrompt(e.target.value))}
        autoSize={{ minRows: 4, maxRows: 10 }}
        placeholder={t('settings.models.translate_model_prompt_message')}></Input.TextArea>
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
