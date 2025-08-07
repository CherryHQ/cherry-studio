import InfoTooltip from '@renderer/components/InfoTooltip'
import { HStack } from '@renderer/components/Layout'
import { useProvider } from '@renderer/hooks/useProvider'
import { isSystemProvider, Provider } from '@renderer/types'
import { Collapse, Flex, Switch } from 'antd'
import { startTransition, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  providerId: string
}

type OptionType = {
  key: string
  label: string
  tip: string
  checked: boolean
  onChange: (checked: boolean) => void
}

const ApiOptionsSettings = ({ providerId }: Props) => {
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

  const openAIOptions: OptionType[] = useMemo(
    () => [
      {
        key: 'openai_developer_role',
        label: t('settings.provider.api.options.developer_role.label'),
        tip: t('settings.provider.api.options.developer_role.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportDeveloperRole: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportDeveloperRole
      },
      {
        key: 'openai_stream_options',
        label: t('settings.provider.api.options.stream_options.label'),
        tip: t('settings.provider.api.options.stream_options.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportStreamOptions: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportStreamOptions
      },
      {
        key: 'openai_array_content',
        label: t('settings.provider.api.options.array_content.label'),
        tip: t('settings.provider.api.options.array_content.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportArrayContent: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportArrayContent
      },
      {
        key: 'openai_service_tier',
        label: t('settings.provider.api.options.service_tier.label'),
        tip: t('settings.provider.api.options.service_tier.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportServiceTier: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportServiceTier
      },
      {
        key: 'openai_enable_thinking',
        label: t('settings.provider.api.options.enable_thinking.label'),
        tip: t('settings.provider.api.options.enable_thinking.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportEnableThinking: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportEnableThinking
      }
    ],
    [t, provider, updateProviderTransition]
  )

  const options = useMemo(() => {
    const items: OptionType[] = []
    if (provider.type === 'openai' || provider.type === 'openai-response' || provider.type === 'azure-openai') {
      items.push(...openAIOptions)
    }
    return items
  }, [openAIOptions, provider.type])

  if (options.length === 0 || isSystemProvider(provider)) {
    return null
  }

  return (
    <>
      <Collapse
        items={[
          {
            key: 'settings',
            styles: {
              header: {
                paddingLeft: 0,
                paddingRight: 6
              },
              body: {
                padding: 0
              }
            },
            label: (
              <div
                style={{
                  fontSize: 14,
                  color: 'var(--color-text-1)',
                  userSelect: 'none',
                  fontWeight: 'bold'
                }}>
                {t('settings.provider.api.options.label')}
              </div>
            ),
            children: (
              <Flex vertical gap="middle">
                {options.map((item) => (
                  <HStack key={item.key} justifyContent="space-between">
                    <HStack alignItems="center" gap={6}>
                      <label style={{ cursor: 'pointer' }} htmlFor={item.key}>
                        {item.label}
                      </label>
                      <InfoTooltip title={item.tip}></InfoTooltip>
                    </HStack>
                    <Switch id={item.key} checked={item.checked} onChange={item.onChange} />
                  </HStack>
                ))}
              </Flex>
            )
          }
        ]}
        ghost
        expandIconPosition="end"
      />
    </>
  )
}

export default ApiOptionsSettings
