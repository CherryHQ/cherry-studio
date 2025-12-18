import { DEFAULT_MAX_TOOL_STEPS, MAX_MAX_TOOL_STEPS } from '@renderer/aiCore/utils/toolSteps'
import { HStack } from '@renderer/components/Layout'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { useProvider } from '@renderer/hooks/useProvider'
import type { Provider } from '@renderer/types'
import { InputNumber } from 'antd'
import { startTransition, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '../..'

type Props = {
  providerId: string
}

const MaxToolStepsSettings = ({ providerId }: Props) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)

  const updateProviderTransition = useCallback(
    (updates: Partial<Provider>) => {
      startTransition(() => {
        updateProvider(updates)
      })
    },
    [updateProvider]
  )

  const maxToolSteps = provider.maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS

  return (
    <>
      <SettingSubtitle>{t('settings.provider.max_tool_steps.title')}</SettingSubtitle>
      <SettingHelpTextRow style={{ paddingTop: 0 }}>
        <SettingHelpText>{t('settings.provider.max_tool_steps.description')}</SettingHelpText>
      </SettingHelpTextRow>

      <HStack justifyContent="space-between" alignItems="center" style={{ marginTop: 8 }}>
        <HStack alignItems="center" gap={6}>
          <label style={{ cursor: 'pointer' }} htmlFor="provider-max-tool-steps">
            {t('settings.provider.max_tool_steps.label')}
          </label>
          <InfoTooltip title={t('settings.provider.max_tool_steps.help')}></InfoTooltip>
        </HStack>
        <InputNumber
          id="provider-max-tool-steps"
          min={1}
          max={MAX_MAX_TOOL_STEPS}
          step={1}
          value={maxToolSteps}
          onChange={(value) => {
            updateProviderTransition({ maxToolSteps: value ?? DEFAULT_MAX_TOOL_STEPS })
          }}
          style={{ width: 160 }}
        />
      </HStack>
    </>
  )
}

export default MaxToolStepsSettings
