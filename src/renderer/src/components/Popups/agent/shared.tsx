import { Avatar, SelectedItemProps, SelectedItems } from '@heroui/react'
import { getProviderLabel } from '@renderer/i18n/label'
import { useTranslation } from 'react-i18next'

export interface BaseOption {
  type: 'type' | 'model'
  key: string
  label: string
  // img src
  avatar: string
}

export interface ModelOption extends BaseOption {
  providerId?: string
}

export function isModelOption(option: BaseOption): option is ModelOption {
  return option.type === 'model'
}

export const Item = ({ item }: { item: SelectedItemProps<BaseOption> }) => <Option option={item.data} />

export const renderOption = (items: SelectedItems<BaseOption>) =>
  items.map((item) => <Item key={item.key} item={item} />)

export const Option = ({ option }: { option?: BaseOption | null }) => {
  const { t } = useTranslation()
  if (!option) {
    return (
      <div className="flex gap-2">
        <Avatar name="?" className="h-5 w-5" />
        {t('common.invalid_value')}
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <Avatar src={option.avatar} className="h-5 w-5" />
      {option.label} {isModelOption(option) && option.providerId && `| ${getProviderLabel(option.providerId)}`}
    </div>
  )
}
