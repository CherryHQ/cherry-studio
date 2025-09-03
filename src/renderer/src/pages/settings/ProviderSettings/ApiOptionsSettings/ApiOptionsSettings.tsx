import { HStack } from '@renderer/components/Layout'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { useProvider } from '@renderer/hooks/useProvider'
import { Provider } from '@renderer/types'
import { Flex, Switch } from 'antd'
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
            apiOptions: { ...provider.apiOptions, isSupportDeveloperRole: checked }
          })
        },
        checked: !!provider.apiOptions?.isSupportDeveloperRole
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
        key: 'openai_service_tier',
        label: t('settings.provider.api.options.service_tier.label'),
        tip: t('settings.provider.api.options.service_tier.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isSupportServiceTier: checked }
          })
        },
        checked: !!provider.apiOptions?.isSupportServiceTier
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
    const items: OptionType[] = [
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
      }
    ]

    if (provider.type === 'openai' || provider.type === 'openai-response' || provider.type === 'azure-openai') {
      items.push(...openAIOptions)
    }

    return items
  }, [openAIOptions, provider.apiOptions, provider.type, t, updateProviderTransition])

  return (
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

export default ApiOptionsSettings
