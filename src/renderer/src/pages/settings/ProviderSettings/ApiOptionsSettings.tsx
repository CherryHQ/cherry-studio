import { HStack } from '@renderer/components/Layout'
import { useProvider } from '@renderer/hooks/useProvider'
import { Collapse, Flex, Switch } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  providerId: string
}

type OptionType = {
  key: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

const ApiOptionsSettings = ({ providerId }: Props) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)

  const openAIOptions = useMemo(
    () => [
      {
        key: 'openai_developer_role',
        label: t('settings.provider.api.options.developer_role'),
        onChange: (checked: boolean) => {
          updateProvider({ ...provider, isNotSupportDeveloperRole: !checked })
        },
        checked: !provider.isNotSupportDeveloperRole
      },
      {
        key: 'openai_stream_options',
        label: t('settings.provider.api.options.stream_options'),
        onChange: (checked: boolean) => {
          updateProvider({ ...provider, isNotSupportStreamOptions: !checked })
        },
        checked: !provider.isNotSupportStreamOptions
      },
      {
        key: 'openai_array_content',
        label: t('settings.provider.api.options.array_content'),
        onChange: (checked: boolean) => {
          updateProvider({ ...provider, isNotSupportArrayContent: !checked })
        },
        checked: !provider.isNotSupportArrayContent
      }
    ],
    [t, provider, updateProvider]
  )

  const options = useMemo(() => {
    const items: OptionType[] = []
    if (provider.type === 'openai' || provider.type === 'openai-response' || provider.type === 'azure-openai') {
      items.push(...openAIOptions)
    }
    return items
  }, [openAIOptions, provider.type])

  // <Checkbox
  //       checked={isNotSupportArrayContent}
  //       onChange={(e) => {
  //         setIsNotSupportArrayContent(e.target.checked)
  //         updateProvider({ ...provider, isNotSupportArrayContent: e.target.checked })
  //       }}>
  //       <CheckboxLabelContainer>
  //         {t('settings.provider.is_not_support_array_content.label')}
  //         <Tooltip title={t('settings.provider.is_not_support_array_content.tip')}>
  //           <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
  //         </Tooltip>
  //       </CheckboxLabelContainer>
  //     </Checkbox>

  return (
    <>
      <Collapse
        items={[
          {
            key: 'settings',
            styles: {
              header: {
                paddingLeft: 0
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
                    {item.label}
                    <Switch checked={item.checked} onChange={item.onChange} />
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
