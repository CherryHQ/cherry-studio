import { Flex, InfoTooltip, Switch } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import EditableNumber from '@renderer/components/EditableNumber'
import { useTheme } from '@renderer/hooks/useTheme'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingsContentColumn, SettingTitle } from '..'

const CodeExecutionSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [codeExecution, setCodeExecution] = useMultiplePreferences({
    enabled: 'chat.code.execution.enabled',
    timeoutMinutes: 'chat.code.execution.timeout_minutes'
  })
  const [codeImageTools, setCodeImageTools] = usePreference('chat.code.image_tools')

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('chat.settings.code.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <Flex className="items-center gap-1">
            <SettingRowTitle>{t('chat.settings.code_execution.title')}</SettingRowTitle>
            <InfoTooltip content={t('chat.settings.code_execution.tip')} />
          </Flex>
          <Switch
            checked={codeExecution.enabled}
            onCheckedChange={(checked) => setCodeExecution({ enabled: checked })}
          />
        </SettingRow>
        {codeExecution.enabled && (
          <>
            <SettingDivider />
            <SettingRow>
              <Flex className="items-center gap-1">
                <SettingRowTitle>{t('chat.settings.code_execution.timeout_minutes.label')}</SettingRowTitle>
                <InfoTooltip content={t('chat.settings.code_execution.timeout_minutes.tip')} />
              </Flex>
              <EditableNumber
                size="small"
                className="w-20 text-sm"
                min={1}
                max={60}
                step={1}
                value={codeExecution.timeoutMinutes}
                onChange={(value) => setCodeExecution({ timeoutMinutes: value ?? 1 })}
              />
            </SettingRow>
          </>
        )}
        <SettingDivider />
        <SettingRow>
          <Flex className="items-center gap-1">
            <SettingRowTitle>{t('chat.settings.code_image_tools.label')}</SettingRowTitle>
            <InfoTooltip content={t('chat.settings.code_image_tools.tip')} />
          </Flex>
          <Switch checked={codeImageTools} onCheckedChange={setCodeImageTools} />
        </SettingRow>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default CodeExecutionSettings
