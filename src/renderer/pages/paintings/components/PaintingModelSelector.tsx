import { Avatar, AvatarFallback, Button } from '@cherrystudio/ui'
import { resolveIcon } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { getProviderDisplayName } from '@renderer/components/ModelSelector/utils'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { createUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { isGenerateImageModel } from '@shared/utils/model'
import { first } from 'lodash'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { models } = useModels()
  const { providers } = useProviders({ enabled: true })

  const selectedModelId = useMemo(
    () =>
      painting.providerId && painting.model ? createUniqueModelId(painting.providerId, painting.model) : undefined,
    [painting.providerId, painting.model]
  )

  const selectedModel = useMemo(
    () =>
      painting.model
        ? models.find((model) => model.providerId === painting.providerId && model.apiModelId === painting.model)
        : undefined,
    [models, painting.providerId, painting.model]
  )

  const selectedProvider = useMemo(
    () => (painting.providerId ? providers.find((provider) => provider.id === painting.providerId) : undefined),
    [providers, painting.providerId]
  )

  const selectedName = selectedModel?.name ?? painting.model
  const selectedProviderName = selectedProvider ? getProviderDisplayName(selectedProvider) : undefined
  const selectedIcon = useMemo(() => {
    if (!painting.providerId) return undefined
    const identifier = selectedModel?.apiModelId ?? painting.model
    if (!identifier) return undefined
    return resolveIcon(identifier, painting.providerId) ?? resolveIcon(selectedModel?.name ?? '', painting.providerId)
  }, [painting.providerId, painting.model, selectedModel])

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
        value={selectedModelId}
        onSelect={(uniqueModelId) => {
          if (!uniqueModelId) return
          const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
          onSelect({ providerId, modelId })
        }}
        filter={isGenerateImageModel}
        showTagFilter={false}
        showPinnedModels={false}
        showPinActions={false}
        prioritizedProviderIds={painting.providerId ? [painting.providerId] : undefined}
        contentClassName="w-[min(420px,calc(100vw-2rem))] rounded-[8px]"
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto w-full max-w-none justify-between gap-2 rounded-[8px] border border-border-subtle bg-secondary px-2.5 py-1.5 text-muted-foreground text-xs shadow-none hover:bg-secondary-hover hover:text-foreground',
              className
            )}>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {selectedName ? (
                selectedIcon ? (
                  <selectedIcon.Avatar size={18} className="shrink-0" />
                ) : (
                  <Avatar className="size-[18px] shrink-0 items-center justify-center rounded-lg">
                    <AvatarFallback className="rounded-lg text-[10px]">{first(selectedName) || 'M'}</AvatarFallback>
                  </Avatar>
                )
              ) : null}
              <span className="min-w-0 truncate text-foreground/90">
                {selectedName ? (
                  <>
                    {selectedName}
                    {selectedProviderName && (
                      <span className="text-muted-foreground/80"> | {selectedProviderName}</span>
                    )}
                  </>
                ) : (
                  t('paintings.select_model')
                )}
              </span>
            </div>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
          </Button>
        }
      />
    </div>
  )
}

export default PaintingModelSelector
