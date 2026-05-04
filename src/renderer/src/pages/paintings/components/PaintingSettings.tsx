import {
  Button,
  InfoTooltip,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { X } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'
import type { ModelOption } from '../hooks/useModelLoader'
import type { PaintingData } from '../model/types/paintingData'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import { PaintingProviderSidebarContent } from '../providers/rendering'
import type { BaseConfigItem } from '../providers/shared/providerFieldSchema'
import type { PaintingProviderDefinition } from '../providers/types'
import PaintingsSectionTitle from './PaintingsSectionTitle'

export function PaintingSettingsPanelHeader({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()

  return (
    <>
      <div className="flex min-w-0 flex-col">
        <span className="text-foreground text-xs tracking-wider">{t('common.settings')}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 rounded-full text-muted-foreground"
        onClick={onClose}>
        <X className="size-3.5" />
      </Button>
    </>
  )
}

type SidebarModelOption = {
  label: string
  value: string
  group?: string
}

type ModelSelectConfig = {
  value: string
  options: SidebarModelOption[]
  onChange: (modelId: string) => void
  loading?: boolean
  placeholder?: string
  extra?: ReactNode
}

export interface PaintingSettingsProps {
  provider: PaintingProviderRuntime
  providerDefinition: PaintingProviderDefinition
  modelOptions: ModelOption[]
  isLoading: boolean
  tab: string
  modelSelect?: ModelSelectConfig | ReactNode | null
  showModelSection?: boolean
  configItems: BaseConfigItem[]
  painting: PaintingData
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
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
        {config.extra ? <span className="ml-auto">{config.extra}</span> : null}
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

const PaintingSettings: FC<PaintingSettingsProps> = ({
  provider,
  providerDefinition,
  modelOptions,
  isLoading,
  tab,
  modelSelect,
  showModelSection = true,
  configItems,
  painting,
  onConfigChange,
  onGenerateRandomSeed
}) => {
  const { t } = useTranslation()
  const paintingRecord = painting as unknown as Record<string, unknown>

  const handleImageUpload = useCallback(
    (key: string, file: File) => {
      providerDefinition.image?.onUpload?.({
        key,
        file,
        patchPainting: onConfigChange as (updates: Partial<PaintingData>) => void
      })
    },
    [onConfigChange, providerDefinition.image]
  )

  const getImagePreviewSrc = useCallback(
    (key: string) => {
      return providerDefinition.image?.getPreviewSrc?.({
        key,
        painting
      })
    },
    [painting, providerDefinition.image]
  )

  const onImageUpload = providerDefinition.image?.onUpload ? handleImageUpload : undefined
  const imagePreviewResolver = providerDefinition.image?.getPreviewSrc ? getImagePreviewSrc : undefined

  return (
    <>
      {showModelSection &&
        modelSelect &&
        (isReactNode(modelSelect) ? modelSelect : <ModelSelectFromConfig config={modelSelect} />)}

      {configItems
        .filter((item) => !item.condition || item.condition(paintingRecord))
        .map((item, index) => (
          <div key={item.key || index}>
            {item.title && (
              <PaintingsSectionTitle>
                {t(item.title)}
                {item.tooltip && <InfoTooltip content={t(item.tooltip)} />}
              </PaintingsSectionTitle>
            )}
            <PaintingFieldRenderer
              item={item}
              painting={paintingRecord}
              translate={t}
              onChange={(updates) => onConfigChange(updates as Partial<PaintingData>)}
              onGenerateRandomSeed={onGenerateRandomSeed}
              onImageUpload={onImageUpload ? (key, file) => onImageUpload(key, file) : undefined}
              imagePreviewSrc={imagePreviewResolver ? imagePreviewResolver(item.key || '') : undefined}
              imagePlaceholder={providerDefinition.image?.placeholder}
            />
          </div>
        ))}

      <PaintingProviderSidebarContent
        provider={provider}
        painting={painting}
        modelOptions={modelOptions}
        isLoading={isLoading}
        patchPainting={onConfigChange}
        tab={tab}
      />
    </>
  )
}

export default PaintingSettings
