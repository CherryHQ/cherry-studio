import {
  InfoTooltip,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import type { Provider } from '@types'
import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem } from './PaintingConfigFieldRenderer'
import { PaintingConfigFieldRenderer } from './PaintingConfigFieldRenderer'
import PaintingsSectionTitle from './PaintingsSectionTitle'
import ProviderSelect from './ProviderSelect'

type ModelOption = {
  label: string
  value: string
  group?: string
}

type ModelSelectConfig = {
  value: string
  options: ModelOption[]
  onChange: (modelId: string) => void
  loading?: boolean
  placeholder?: string
  extra?: ReactNode
}

export interface PaintingSettingsSidebarProps {
  provider: Provider
  options: string[]
  onProviderChange: (id: string) => void
  providerHeaderExtra?: ReactNode
  modelSelect: ModelSelectConfig | ReactNode
  configItems: BaseConfigItem[]
  painting: Record<string, unknown>
  onConfigChange: (updates: Record<string, unknown>) => void
  onGenerateRandomSeed?: (key: string) => void
  onImageUpload?: (key: string, file: File) => void
  getImagePreviewSrc?: (key: string) => string | undefined
  imagePlaceholder?: ReactNode
  extraContent?: ReactNode
}

function isReactNode(value: ModelSelectConfig | ReactNode): value is ReactNode {
  return typeof value !== 'object' || value === null || !('options' in value) || !('onChange' in value)
}

function ModelSelectFromConfig({ config }: { config: ModelSelectConfig }) {
  const { t } = useTranslation()

  const grouped = useMemo(() => {
    const groups = new Map<string, ModelOption[]>()
    let hasGroups = false
    for (const option of config.options) {
      if (option.group) {
        hasGroups = true
        const list = groups.get(option.group) || []
        list.push(option)
        groups.set(option.group, list)
      }
    }
    return hasGroups ? groups : null
  }, [config.options])

  return (
    <>
      <PaintingsSectionTitle>
        {t('common.model')}
        {config.extra}
      </PaintingsSectionTitle>
      <Select value={config.value} onValueChange={config.onChange}>
        <SelectTrigger className="mb-4 h-10 min-h-10 w-full border-transparent bg-muted/40 transition-all hover:bg-muted/60">
          <SelectValue placeholder={config.loading ? t('common.loading') : config.placeholder || t('common.model')} />
        </SelectTrigger>
        <SelectContent>
          {grouped
            ? Array.from(grouped.entries()).map(([groupName, items]) => (
                <SelectGroup key={groupName}>
                  <SelectLabel>{groupName}</SelectLabel>
                  {items.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))
            : config.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
        </SelectContent>
      </Select>
    </>
  )
}

const PaintingSettingsSidebar: FC<PaintingSettingsSidebarProps> = ({
  provider,
  options,
  onProviderChange,
  providerHeaderExtra,
  modelSelect,
  configItems,
  painting,
  onConfigChange,
  onGenerateRandomSeed,
  onImageUpload,
  getImagePreviewSrc,
  imagePlaceholder,
  extraContent
}) => {
  const { t } = useTranslation()

  return (
    <>
      <PaintingsSectionTitle className="mt-0">
        {t('common.provider')}
        {providerHeaderExtra}
      </PaintingsSectionTitle>
      <ProviderSelect provider={provider} options={options} onChange={onProviderChange} className="mb-4" />

      {isReactNode(modelSelect) ? modelSelect : <ModelSelectFromConfig config={modelSelect} />}

      {configItems
        .filter((item) => !item.condition || item.condition(painting))
        .map((item, index) => (
          <div key={item.key || index}>
            {item.title && (
              <PaintingsSectionTitle>
                {t(item.title)}
                {item.tooltip && <InfoTooltip content={t(item.tooltip)} />}
              </PaintingsSectionTitle>
            )}
            <PaintingConfigFieldRenderer
              item={item}
              painting={painting}
              translate={t}
              onChange={onConfigChange}
              onGenerateRandomSeed={onGenerateRandomSeed}
              onImageUpload={onImageUpload ? (key, file) => onImageUpload(key, file) : undefined}
              imagePreviewSrc={getImagePreviewSrc ? getImagePreviewSrc(item.key || '') : undefined}
              imagePlaceholder={imagePlaceholder}
            />
          </div>
        ))}

      {extraContent}
    </>
  )
}

export default PaintingSettingsSidebar
