import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { parseUniqueModelId } from '@shared/data/types/model'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePaintingModelCatalog } from '../hooks/usePaintingModelCatalog'
import { usePaintingProviderOptions } from '../hooks/usePaintingProviderOptions'
import type { PaintingData } from '../model/types/paintingData'
import PaintingSectionTitle from './PaintingSectionTitle'

interface PaintingModelSelectorProps {
  className?: string
  painting: PaintingData
  onSelect: (selection: { providerId: string; modelId: string }) => void
}

const PaintingModelSelector: FC<PaintingModelSelectorProps> = ({ className, painting, onSelect }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const providerOptions = usePaintingProviderOptions()
  const { selectorData, isLoading } = usePaintingModelCatalog({
    providerOptions,
    painting,
    shouldPrefetch: open
  })
  const currentProviderId = painting.providerId

  return (
    <div>
      <PaintingSectionTitle>{t('paintings.model')}</PaintingSectionTitle>
      <ModelSelector
        open={open}
        onOpenChange={setOpen}
        multiple={false}
        selectionType="id"
        value={selectorData.selectedModelId}
        onSelect={(uniqueModelId) => {
          if (!uniqueModelId) {
            return
          }

          const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
          onSelect({ providerId, modelId })
        }}
        dataOverride={{
          providers: selectorData.providers,
          models: selectorData.models,
          isLoading
        }}
        showPinnedModels={false}
        showPinActions={false}
        showTagFilter={false}
        prioritizedProviderIds={[currentProviderId]}
        contentClassName="w-[min(420px,calc(100vw-2rem))]"
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto w-full max-w-none justify-between gap-2 rounded-[var(--painting-radius-track)] border border-border/50 bg-[var(--painting-control-bg)] px-2.5 py-[6px] text-muted-foreground text-xs shadow-none hover:bg-[var(--painting-control-bg-hover)] hover:text-foreground',
              className
            )}>
            <span className="flex min-w-0 items-center gap-2">
              <ProviderAvatarPrimitive
                providerId={currentProviderId}
                providerName={selectorData.selectedProviderName || currentProviderId}
                size={16}
              />
              <span className="truncate text-foreground/90">
                {selectorData.selectedModelName || t('paintings.select_model')}
              </span>
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
          </Button>
        }
      />
    </div>
  )
}

export default PaintingModelSelector
