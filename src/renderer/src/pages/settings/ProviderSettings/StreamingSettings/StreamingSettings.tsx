import { DEFAULT_MAX_TOOL_STEPS, MAX_MAX_TOOL_STEPS } from '@renderer/aiCore/utils/streamingTimeout'
import { HStack } from '@renderer/components/Layout'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { useProvider } from '@renderer/hooks/useProvider'
import type { Provider } from '@renderer/types'
import { Button, Flex, InputNumber } from 'antd'
import { startTransition, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '../..'

type Props = {
  providerId: string
}

const StreamingSettings = ({ providerId }: Props) => {
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

  const requestTimeoutMinutes = provider.requestTimeoutMinutes ?? 0
  const sseIdleTimeoutMinutes = provider.sseIdleTimeoutMinutes ?? 0
  const maxToolSteps = provider.maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS

  return (
    <Flex vertical gap="middle">
      <SettingSubtitle style={{ marginTop: 0 }}>{t('settings.provider.streaming.title')}</SettingSubtitle>
      <SettingHelpTextRow style={{ paddingTop: 0 }}>
        <SettingHelpText>{t('settings.provider.streaming.description')}</SettingHelpText>
      </SettingHelpTextRow>

      <HStack justifyContent="space-between" alignItems="center">
        <HStack alignItems="center" gap={6}>
          <label style={{ cursor: 'pointer' }} htmlFor="provider-request-timeout-minutes">
            {t('settings.provider.streaming.request_timeout.label')}
          </label>
          <InfoTooltip title={t('settings.provider.streaming.request_timeout.help')}></InfoTooltip>
        </HStack>
        <InputNumber
          id="provider-request-timeout-minutes"
          min={0}
          max={720}
          step={1}
          value={requestTimeoutMinutes}
          onChange={(value) => {
            updateProviderTransition({ requestTimeoutMinutes: value ?? 0 })
          }}
          style={{ width: 160 }}
        />
      </HStack>

      <HStack justifyContent="space-between" alignItems="center">
        <HStack alignItems="center" gap={6}>
          <label style={{ cursor: 'pointer' }} htmlFor="provider-sse-idle-timeout-minutes">
            {t('settings.provider.streaming.sse_idle_timeout.label')}
          </label>
          <InfoTooltip title={t('settings.provider.streaming.sse_idle_timeout.help')}></InfoTooltip>
        </HStack>
        <InputNumber
          id="provider-sse-idle-timeout-minutes"
          min={0}
          max={720}
          step={1}
          value={sseIdleTimeoutMinutes}
          onChange={(value) => {
            updateProviderTransition({ sseIdleTimeoutMinutes: value ?? 0 })
          }}
          style={{ width: 160 }}
        />
      </HStack>

      <HStack justifyContent="space-between" alignItems="center">
        <HStack alignItems="center" gap={6}>
          <label style={{ cursor: 'pointer' }} htmlFor="provider-max-tool-steps">
            {t('settings.provider.streaming.max_tool_steps.label')}
          </label>
          <InfoTooltip title={t('settings.provider.streaming.max_tool_steps.help')}></InfoTooltip>
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

      <HStack justifyContent="flex-end">
        <Button
          onClick={() => {
            updateProviderTransition({
              requestTimeoutMinutes: 0,
              sseIdleTimeoutMinutes: 0,
              maxToolSteps: DEFAULT_MAX_TOOL_STEPS
            })
          }}>
          {t('settings.provider.streaming.reset')}
        </Button>
      </HStack>
    </Flex>
  )
}

export default StreamingSettings
