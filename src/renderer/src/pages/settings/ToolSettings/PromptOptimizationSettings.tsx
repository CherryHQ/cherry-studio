import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/pages/settings/index'
import store from '@renderer/store'
import { Button } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const PromptOptimizationSettings = () => {
  const { t } = useTranslation()
  const { promptOptimizationTemplate } = useSettings()
  const { theme: themeMode } = useTheme()

  const handleSave = useCallback((value: string) => {
    store.dispatch({ type: 'settings/setPromptOptimizationTemplate', payload: value })
  }, [])

  return (
    <SettingContainer theme={themeMode}>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('agents.settings.tool.promptOptimization.title')}</SettingTitle>
        <SettingDivider />

        <SettingRow>
          <SettingRowTitle>{t('agents.settings.tool.promptOptimization.description')}</SettingRowTitle>
        </SettingRow>

        <SettingRow>
          <TextArea
            rows={10}
            value={promptOptimizationTemplate}
            onChange={(e) => handleSave(e.target.value)}
            placeholder={t('agents.settings.tool.promptOptimization.placeholder')}
            style={{ width: '100%' }}
          />
        </SettingRow>

        <SettingRow>
          <ul style={{ marginTop: 12, paddingLeft: 20, color: 'var(--color-text-2)' }}>
            <li>{t('agents.settings.tool.promptOptimization.tip1')}</li>
            <li>{t('agents.settings.tool.promptOptimization.tip2')}</li>
          </ul>
        </SettingRow>

        <SettingRow>
          <Button type="primary" onClick={() => handleSave('')} style={{ marginTop: 16 }}>
            {t('agents.settings.tool.promptOptimization.reset')}
          </Button>
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

export default PromptOptimizationSettings
