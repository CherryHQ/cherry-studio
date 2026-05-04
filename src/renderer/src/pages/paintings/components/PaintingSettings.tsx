import { Button, InfoTooltip } from '@cherrystudio/ui'
import { X } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'
import type { PaintingData } from '../model/types/paintingData'
import type { ModelOption } from '../model/types/paintingModel'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'
import { resolvePaintingProviderDefinition } from '../utils/paintingProviderMode'
import { PaintingSettingsExtras } from './PaintingProviderViews'
import PaintingsSectionTitle from './PaintingsSectionTitle'

export function PaintingSettingsHeader({
  onClose,
  actions
}: {
  onClose: () => void
  /** Inline with title: e.g. provider “Learn more” before the close button. */
  actions?: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="min-w-0 truncate text-foreground text-xs tracking-wider">{t('common.settings')}</span>
      <div className="flex shrink-0 flex-nowrap items-center gap-x-2">
        {actions}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0 rounded-full text-muted-foreground"
          onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export interface PaintingSettingsProps {
  provider: PaintingProviderRuntime
  modelOptions: ModelOption[]
  selectedModelOption?: ModelOption
  isLoading: boolean
  tab: string
  painting: PaintingData
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}

const PaintingSettings: FC<PaintingSettingsProps> = ({
  provider,
  modelOptions,
  selectedModelOption,
  isLoading,
  tab,
  painting,
  onConfigChange,
  onGenerateRandomSeed
}) => {
  const { t } = useTranslation()
  const paintingRecord = painting as unknown as Record<string, unknown>

  const providerDefinition = useMemo(() => resolvePaintingProviderDefinition(provider.id), [provider.id])
  const configItems = useMemo(() => providerDefinition.fields.byTab[tab] || [], [providerDefinition.fields.byTab, tab])

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

      <PaintingSettingsExtras
        provider={provider}
        painting={painting}
        modelOptions={modelOptions}
        selectedModelOption={selectedModelOption}
        isLoading={isLoading}
        patchPainting={onConfigChange}
        tab={tab}
      />
    </>
  )
}

export default PaintingSettings
