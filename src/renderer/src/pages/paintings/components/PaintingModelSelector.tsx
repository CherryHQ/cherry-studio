import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/ModelSelector'
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

/**
 * Model entry stays interactive even when the current provider is disabled in settings.
 * PR review once asked to grey out / block the trigger in that case (commit 00a0bf9c0);
 * that was reverted: sponsored-provider flows need browsing and model pick first; enforcement
 * stays on submit in `usePaintingGenerationGuard` (`provider_disabled`).
 */
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
      <PaintingSectionTitle>
        <span className="min-w-0 truncate">{t('paintings.model')}</span>
      </PaintingSectionTitle>
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
              'h-auto w-full max-w-none justify-between gap-2 rounded-(--painting-radius-track) border border-border-subtle bg-(--painting-control-bg) px-2.5 py-1.5 text-muted-foreground text-xs shadow-none hover:bg-(--painting-control-bg-hover) hover:text-foreground',
              className
            )}>
            <span className="min-w-0 truncate text-foreground/90">
              {selectorData.selectedModelName || t('paintings.select_model')}
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
          </Button>
        }
      />
    </div>
  )
}

export default PaintingModelSelector
