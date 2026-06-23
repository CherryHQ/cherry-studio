import { Avatar, AvatarFallback, Button } from '@cherrystudio/ui'
import { resolveIcon } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/Selector/model'
import { getProviderDisplayName } from '@renderer/components/Selector/model/utils'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import type { CreationKind } from '@shared/data/types/creation'
import { createUniqueModelId, type Model, parseUniqueModelId } from '@shared/data/types/model'
import { isGenerateImageModel, isGenerateVideoModel } from '@shared/utils/model'
import { first } from 'lodash'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CreationSectionTitle from './CreationSectionTitle'

export interface CreationModelSelection {
  providerId: string
  modelId: string
}

export interface CreationModelKindSelection extends CreationModelSelection {
  kind: CreationKind
}

interface CreationModelSelectorProps {
  className?: string
  providerId?: string
  modelId?: string
  onSelect: (selection: CreationModelKindSelection) => void
}

const isCreationModel = (model: Model) => isGenerateImageModel(model) || isGenerateVideoModel(model)

const CreationModelSelector: FC<CreationModelSelectorProps> = ({ className, providerId, modelId, onSelect }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { models } = useModels()
  const { providers } = useProviders({ enabled: true })

  const selectedModelId = useMemo(
    () => (providerId && modelId ? createUniqueModelId(providerId, modelId) : undefined),
    [providerId, modelId]
  )

  const selectedModel = useMemo(
    () =>
      modelId ? models.find((model) => model.providerId === providerId && model.apiModelId === modelId) : undefined,
    [models, providerId, modelId]
  )

  const selectedProvider = useMemo(
    () => (providerId ? providers.find((provider) => provider.id === providerId) : undefined),
    [providers, providerId]
  )

  const selectedName = selectedModel?.name ?? modelId
  const selectedProviderName = selectedProvider ? getProviderDisplayName(selectedProvider) : undefined
  const selectedIcon = useMemo(() => {
    if (!providerId) return undefined
    const identifier = selectedModel?.apiModelId ?? modelId
    if (!identifier) return undefined
    return resolveIcon(identifier, providerId) ?? resolveIcon(selectedModel?.name ?? '', providerId)
  }, [providerId, modelId, selectedModel])

  return (
    <div>
      <CreationSectionTitle>
        <span className="min-w-0 truncate">{t('paintings.model')}</span>
      </CreationSectionTitle>
      <ModelSelector
        open={open}
        onOpenChange={setOpen}
        multiple={false}
        selectionType="id"
        value={selectedModelId}
        onSelect={(uniqueModelId) => {
          if (!uniqueModelId) return
          const parsed = parseUniqueModelId(uniqueModelId)
          const model = models.find(
            (item) => item.providerId === parsed.providerId && item.apiModelId === parsed.modelId
          )
          onSelect({
            providerId: parsed.providerId,
            modelId: parsed.modelId,
            kind: model && isGenerateVideoModel(model) ? 'video' : 'image'
          })
        }}
        filter={isCreationModel}
        showTagFilter={false}
        showPinnedModels={false}
        showPinActions={false}
        prioritizedProviderIds={providerId ? [providerId] : undefined}
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

export default CreationModelSelector
