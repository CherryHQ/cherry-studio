import { Avatar, AvatarFallback, Button } from '@cherrystudio/ui'
import { resolveIcon } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ModelSelector } from '@renderer/components/Selector/model'
import { getProviderDisplayName } from '@renderer/components/Selector/model/utils'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { createUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { isGenerateImageModel } from '@shared/utils/model'
import { first } from 'lodash'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerDraft } from '../model/composerDraft'
import PaintingSectionTitle from './PaintingSectionTitle'

interface PaintingModelSelectorProps {
  className?: string
  draft: ComposerDraft
  onSelect: (selection: { providerId: string; modelId: string }) => void
  /** Drop the "Model" section title — used by the composer's bottom toolbar. */
  hideTitle?: boolean
}

const PaintingModelSelector: FC<PaintingModelSelectorProps> = ({ className, draft, onSelect, hideTitle }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { models } = useModels()
  const { providers } = useProviders({ enabled: true })

  const selectedModelId = useMemo(
    () => (draft.providerId && draft.model ? createUniqueModelId(draft.providerId, draft.model) : undefined),
    [draft.providerId, draft.model]
  )

  const selectedModel = useMemo(
    () =>
      draft.model
        ? models.find((model) => model.providerId === draft.providerId && model.apiModelId === draft.model)
        : undefined,
    [models, draft.providerId, draft.model]
  )

  const selectedProvider = useMemo(
    () => (draft.providerId ? providers.find((provider) => provider.id === draft.providerId) : undefined),
    [providers, draft.providerId]
  )

  const selectedName = selectedModel?.name ?? draft.model
  const selectedProviderName = selectedProvider ? getProviderDisplayName(selectedProvider) : undefined
  const selectedIcon = useMemo(() => {
    if (!draft.providerId) return undefined
    const identifier = selectedModel?.apiModelId ?? draft.model
    if (!identifier) return undefined
    return resolveIcon(identifier, draft.providerId) ?? resolveIcon(selectedModel?.name ?? '', draft.providerId)
  }, [draft.providerId, draft.model, selectedModel])

  return (
    <div className={hideTitle ? 'contents' : undefined}>
      {!hideTitle && (
        <PaintingSectionTitle>
          <span className="min-w-0 truncate">{t('paintings.model')}</span>
        </PaintingSectionTitle>
      )}
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
        prioritizedProviderIds={draft.providerId ? [draft.providerId] : undefined}
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
