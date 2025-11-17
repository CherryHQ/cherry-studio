import { Select, SelectItem } from '@heroui/react'
import { videoModelsMap } from '@renderer/config/models/video'
import type { Model } from '@renderer/types'
import { useTranslation } from 'react-i18next'

import { SettingItem } from './shared'

export interface ModelSettingProps {
  providerId: string
  modelId: string
  setModelId: (id: string) => void
}

interface ModelSelectItem extends Model {
  key: string
  label: string
}

export const ModelSetting = ({ providerId, modelId, setModelId }: ModelSettingProps) => {
  const { t } = useTranslation()

  const items: ModelSelectItem[] = videoModelsMap[providerId]?.map((m: string) => ({ key: m, label: m })) ?? []

  return (
    <SettingItem>
      <Select
        label={t('common.model')}
        labelPlacement="outside"
        selectionMode="single"
        items={items}
        defaultSelectedKeys={[modelId]}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          if (keys.currentKey) setModelId(keys.currentKey)
        }}>
        {(model) => (
          <SelectItem textValue={model.label}>
            <span>{model.label}</span>
          </SelectItem>
        )}
      </Select>
    </SettingItem>
  )
}
