import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverAnchor, PopoverContent } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useIsActiveTab } from '@renderer/hooks/tab'
import { useModels } from '@renderer/hooks/useModel'
import { cn } from '@renderer/utils/style'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'

const MAX_PREVIEW_MODELS = 3
const SPOTLIGHT_PADDING = 4

interface CherryCloudModelGuideProps {
  anchorRef: RefObject<HTMLElement | null>
  /** False while the conversation cannot accept a model change yet. */
  ready: boolean
  /** The conversation's current model; the guide waits until it reflects the recorded choice. */
  currentModelId: string | undefined
  onSelectModel: (model: Model) => void
}

/**
 * One-shot guide recorded by the plan activation dialog: applies the chosen model through the
 * chat header's own selection handler, then spotlights the header model trigger.
 */
export function CherryCloudModelGuide({ anchorRef, ready, currentModelId, onSelectModel }: CherryCloudModelGuideProps) {
  const { t } = useTranslation()
  const isActiveTab = useIsActiveTab()
  const [guide, setGuide] = usePersistCache('ui.cherry_cloud.model_guide')
  const { models: providerModels, isLoading } = useModels(
    { providerId: CHERRY_CLOUD_PROVIDER_ID },
    { fetchEnabled: guide !== null }
  )
  const enabled = guide !== null && isActiveTab && ready
  const pendingModelId = guide?.selectedModelId ?? null
  const attemptedModelIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !guide || !pendingModelId || isLoading) return
    const model = providerModels.find((candidate) => candidate.id === pendingModelId)
    if (!model || currentModelId === model.id) {
      setGuide({ ...guide, selectedModelId: null, switchedModelId: model?.id ?? null })
      return
    }
    // Apply once: the header recreates its handler while the switch is in flight, so re-calling it loops.
    if (attemptedModelIdRef.current === model.id) return
    attemptedModelIdRef.current = model.id
    onSelectModel(model)
  }, [currentModelId, enabled, guide, isLoading, onSelectModel, pendingModelId, providerModels, setGuide])

  const showGuide = enabled && !pendingModelId
  const anchorRect = useAnchorRect(anchorRef, showGuide)
  const virtualRef = useMemo(
    () => ({ current: { getBoundingClientRect: () => anchorRect ?? new DOMRect() } }),
    [anchorRect]
  )

  if (!showGuide || !guide || !anchorRect) return null

  const byId = new Map(providerModels.map((model) => [model.id, model]))
  const previewModels = guide.modelIds.flatMap((id) => byId.get(id) ?? []).slice(0, MAX_PREVIEW_MODELS)
  const switchedModel = guide.switchedModelId ? byId.get(guide.switchedModelId) : undefined
  const dismiss = () => setGuide(null)

  return (
    <>
      {createPortal(
        <div
          aria-hidden
          // Same dim as the shared Dialog overlay (bg-black/50), with a cutout around the trigger.
          className="pointer-events-none fixed z-[79] rounded-[10px] fade-in-0 animate-in shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] duration-300 motion-reduce:animate-none"
          style={{
            left: anchorRect.left - SPOTLIGHT_PADDING,
            top: anchorRect.top - SPOTLIGHT_PADDING,
            width: anchorRect.width + SPOTLIGHT_PADDING * 2,
            height: anchorRect.height + SPOTLIGHT_PADDING * 2
          }}
        />,
        document.body
      )}
      <Popover open onOpenChange={(open) => !open && dismiss()}>
        <PopoverAnchor virtualRef={virtualRef} />
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={12}
          className="w-76 overflow-hidden rounded-xl p-0"
          aria-labelledby="cherry-cloud-model-guide-title">
          <div className="h-26 overflow-hidden border-border border-b bg-muted px-4 pt-3.5">
            <div className="rounded-t-lg bg-popover px-1 pt-1.5 pb-1 shadow-lg ring-1 ring-border">
              {previewModels.map((model) => (
                <div
                  key={model.id}
                  className={cn(
                    'relative flex h-6.5 items-center gap-2 rounded-md px-2 text-[11px]',
                    model.id === switchedModel?.id && 'bg-accent'
                  )}>
                  {model.id === switchedModel?.id ? (
                    <span className="absolute top-[20%] left-0 h-[60%] w-0.5 rounded-full bg-primary" />
                  ) : null}
                  <ModelAvatar model={model} size={16} />
                  <span className="truncate">{model.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 px-4 pt-3.5 pb-3.5">
            <p id="cherry-cloud-model-guide-title" className="font-semibold text-sm">
              {switchedModel
                ? t('settings.subscription.activation.guide_switched', { model: switchedModel.name })
                : t('settings.subscription.activation.guide_title')}
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t('settings.subscription.activation.guide_description')}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-muted-foreground text-xs">{t('settings.subscription.activation.guide_once')}</span>
              <Button variant="emphasis" size="sm" onClick={dismiss}>
                {t('settings.subscription.activation.guide_dismiss')}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

function useAnchorRect(anchorRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const element = anchorRef.current
    if (!enabled || !element) {
      setRect(null)
      return
    }
    const measure = () => setRect(element.getBoundingClientRect())
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [anchorRef, enabled])
  return rect
}
