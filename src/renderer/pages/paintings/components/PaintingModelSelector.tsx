import { first } from 'es-toolkit/compat'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, Button } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CherryCloudModelSelector as ModelSelector } from '@renderer/components/cherryCloud/CherryCloudModelSelector'
import { getProviderDisplayName, type ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelLogoRef } from '@renderer/utils/model'
import { createUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

import type { PaintingTarget } from '../model/paintingBatch'
import { supportsImageGenerationEndpoint } from '../model/utils/paintingModelOptions'
import PaintingSectionTitle from './PaintingSectionTitle'

const paintingModelFilter: ModelSelectorFilter = supportsImageGenerationEndpoint

interface PaintingModelSelectorProps {
  className?: string
  /** Models chosen for this send. The first one is the draft's primary model. */
  targets: PaintingTarget[]
  onSelect: (targets: PaintingTarget[]) => void
  /** Drop the "Model" section title — used by the composer's bottom toolbar. */
  hideTitle?: boolean
}

const PaintingModelSelector: FC<PaintingModelSelectorProps> = ({ className, targets, onSelect, hideTitle }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { models } = useModels()
  const { providers } = useProviders({ enabled: true })

  const primary = targets[0]

  const selectedModelIds = useMemo(
    () => targets.map((target) => createUniqueModelId(target.providerId, target.modelId)),
    [targets]
  )

  const selectedModel = useMemo(
    () =>
      primary
        ? models.find((model) => model.providerId === primary.providerId && model.apiModelId === primary.modelId)
        : undefined,
    [models, primary]
  )

  const selectedProvider = useMemo(
    () => (primary ? providers.find((provider) => provider.id === primary.providerId) : undefined),
    [providers, primary]
  )

  const selectedName = selectedModel?.name ?? primary?.modelId
  const selectedProviderName = selectedProvider ? getProviderDisplayName(selectedProvider) : undefined
  const selectedIconRef = useMemo(
    () =>
      primary
        ? getModelLogoRef(selectedModel ?? { id: primary.modelId, name: primary.modelId }, primary.providerId)
        : undefined,
    [primary, selectedModel]
  )
  const selectedIcon = useIcon(selectedIconRef)

  return (
    <div className={hideTitle ? 'contents' : undefined}>
      {!hideTitle && (
        <PaintingSectionTitle>
          <span className="min-w-0 truncate">{t('paintings.model')}</span>
        </PaintingSectionTitle>
      )}
      <ModelSelector
        showSubscriptionOffers={false}
        open={open}
        onOpenChange={setOpen}
        multiple
        selectionType="id"
        value={selectedModelIds}
        onSelect={(uniqueModelIds) => {
          onSelect(
            uniqueModelIds.map((uniqueModelId) => {
              const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
              return { providerId, modelId }
            })
          )
        }}
        filter={paintingModelFilter}
        showTagFilter={false}
        showPinnedModels={false}
        showPinActions={false}
        contentClassName="w-[min(420px,calc(100vw-2rem))] rounded-[8px]"
        trigger={
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              'h-auto w-full max-w-none justify-between gap-2 rounded-[8px] border border-border-subtle px-2.5 py-1.5 text-xs text-muted-foreground shadow-none hover:text-foreground',
              className
            )}>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {targets.length <= 1 && selectedName ? (
                selectedIcon ? (
                  <selectedIcon.Avatar size={18} className="shrink-0" />
                ) : (
                  <Avatar className="size-[18px] shrink-0 items-center justify-center rounded-lg">
                    <AvatarFallback className="rounded-lg text-[10px]">{first(selectedName) || 'M'}</AvatarFallback>
                  </Avatar>
                )
              ) : null}
              <span className="min-w-0 truncate text-foreground">
                {targets.length > 1 ? (
                  t('paintings.batch.selected_count', { count: targets.length })
                ) : selectedName ? (
                  <>
                    {selectedName}
                    {selectedProviderName && <span className="text-muted-foreground"> | {selectedProviderName}</span>}
                  </>
                ) : (
                  t('paintings.select_model')
                )}
              </span>
            </div>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
    </div>
  )
}

export default PaintingModelSelector
