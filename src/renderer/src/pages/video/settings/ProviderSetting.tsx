import { Select, SelectItem } from '@heroui/react'
import { ProviderAvatar } from '@renderer/components/ProviderAvatar'
import { useProviders } from '@renderer/hooks/useProvider'
import type { Provider, SystemProviderId } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingItem } from './shared'

export interface ProviderSettingProps {
  providerId: string
  setProviderId: Dispatch<SetStateAction<string>>
}

interface ProviderSelectItem extends Provider {
  key: string
  label: string
}

export const ProviderSetting = ({ providerId, setProviderId }: ProviderSettingProps) => {
  const { t } = useTranslation()
  // Support limited providers.
  const supportedProviderIds = ['openai'] satisfies SystemProviderId[]
  const { providers } = useProviders()
  const items: ProviderSelectItem[] = providers
    .filter((p) => supportedProviderIds.some((id) => id === p.id))
    .map((p) => ({ ...p, key: p.id, label: getFancyProviderName(p) }))

  return (
    <SettingItem>
      <Select
        label={t('common.provider')}
        labelPlacement="outside"
        selectionMode="single"
        items={items}
        defaultSelectedKeys={[providerId]}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          if (keys.currentKey) setProviderId(keys.currentKey)
        }}
        renderValue={(items) => {
          const provider = items[0].data
          if (!provider) return null
          return (
            <div className="flex items-center gap-2">
              <ProviderAvatar provider={provider} size={16} />
              <span>{provider.label}</span>
            </div>
          )
        }}>
        {(provider) => (
          <SelectItem textValue={provider.label} startContent={<ProviderAvatar provider={provider} size={16} />}>
            <span>{provider.label}</span>
          </SelectItem>
        )}
      </Select>
    </SettingItem>
  )
}
