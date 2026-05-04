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
            'h-8 max-w-[240px] gap-2 rounded-full px-2.5 text-muted-foreground text-xs hover:bg-muted/50 hover:text-foreground',
            className
          )}>
          <ProviderAvatarPrimitive
            providerId={currentProviderId}
            providerName={selectorData.selectedProviderName || currentProviderId}
            size={16}
          />
          <span className="truncate text-foreground/90">
            {selectorData.selectedModelName || t('paintings.select_model')}
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
        </Button>
      }
    />
  )
}

export default PaintingModelSelector
