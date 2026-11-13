import { ArrowRight, Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogTitle } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useTabs } from '@renderer/hooks/tab'
import { useDefaultModel, useModels } from '@renderer/hooks/useModel'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { cn } from '@renderer/utils/style'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'

import {
  type CherryCloudPlanActivation,
  useCherryCloudSubscriptionReminder
} from '../hooks/useCherryCloudSubscriptionReminder'

const MAX_LISTED_MODELS = 3

/** Owns the subscription reminder for the main window and turns a plan activation into the guide dialog. */
export function CherryCloudPlanActivationHost() {
  const { activation, dismiss } = useCherryCloudSubscriptionReminder()
  return activation ? <CherryCloudPlanActivationDialog activation={activation} onClose={dismiss} /> : null
}

export function CherryCloudPlanActivationDialog({
  activation,
  onClose
}: {
  activation: CherryCloudPlanActivation
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const { activeTab } = useTabs()
  const [, setGuide] = usePersistCache('ui.cherry_cloud.model_guide')
  const { setDefaultModel } = useDefaultModel({ enabled: false })
  const { models: providerModels } = useModels({ providerId: CHERRY_CLOUD_PROVIDER_ID })
  const models = useMemo(() => {
    const byId = new Map(providerModels.map((model) => [model.id, model]))
    return activation.modelIds.flatMap((id) => byId.get(id) ?? [])
  }, [activation.modelIds, providerModels])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [alsoDefault, setAlsoDefault] = useState(false)
  const selected = models.find((model) => model.id === selectedId) ?? models[0]

  if (models.length === 0) return null

  const listed = models.slice(0, MAX_LISTED_MODELS)
  const hiddenCount = models.length - listed.length
  const expiresAt = activation.expiresAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(activation.expiresAt))
    : null

  const finish = (switchTo: Model | null) => {
    setGuide({
      modelIds: models.map((model) => model.id),
      selectedModelId: switchTo?.id ?? null,
      switchedModelId: null
    })
    onClose()
  }

  const startChat = async () => {
    if (!selected) return
    if (alsoDefault) await setDefaultModel(selected)
    finish(selected)
    if (!activeTab?.url.startsWith('/app/chat')) openRoute('/app/chat')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && finish(null)}>
      <DialogContent size="sm" className="gap-0 overflow-hidden p-0 sm:max-w-[312px]" closeLabel={t('common.close')}>
        <ActivationIllustration />
        <div className="flex flex-col gap-2.5 px-4 pt-3 pb-3.5">
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="text-sm leading-tight">{t('settings.subscription.activation.title')}</DialogTitle>
            <DialogDescription className="text-[11px] leading-snug">
              {expiresAt
                ? t('settings.subscription.activation.description_until', { date: expiresAt })
                : t('settings.subscription.activation.description')}
            </DialogDescription>
          </div>
          <div
            role="radiogroup"
            aria-label={t('settings.subscription.activation.models_label')}
            className="flex flex-col gap-0.5 rounded-lg bg-accent p-1">
            {listed.map((model) => {
              const checked = model.id === selected?.id
              return (
                <button
                  key={model.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setSelectedId(model.id)}
                  className={cn(
                    'flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                    'focus-visible:bg-background focus-visible:outline-hidden',
                    checked ? 'bg-background shadow-xs' : 'hover:bg-background/50'
                  )}>
                  <ModelAvatar model={model} size={16} />
                  <span className="min-w-0 flex-1 truncate font-medium">{model.name}</span>
                  <Check size={12} aria-hidden className={cn('shrink-0', !checked && 'invisible')} />
                </button>
              )
            })}
            {hiddenCount > 0 ? (
              <p className="px-2 pt-0.5 pb-0.5 text-[10px] text-muted-foreground">
                {t('settings.subscription.activation.more_models', { count: hiddenCount })}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <Checkbox size="sm" checked={alsoDefault} onCheckedChange={(next) => setAlsoDefault(next === true)} />
              {t('settings.subscription.activation.set_default')}
            </label>
            <Button variant="emphasis" size="sm" onClick={() => void startChat()}>
              {t('settings.subscription.activation.start_chat')}
              <ArrowRight size={12} aria-hidden />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A neutral sketch of the model menu: independent of the plan, its name and its models. */
const SPARKLE_PATH = 'M12 0c.6 6.4 5.6 11.4 12 12-6.4.6-11.4 5.6-12 12-.6-6.4-5.6-11.4-12-12C6.4 11.4 11.4 6.4 12 0Z'
const DOT_GRID_STYLE = {
  backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1.3px)',
  backgroundSize: '12px 12px',
  maskImage: 'radial-gradient(ellipse 70% 80% at 50% 60%, #000 25%, transparent 75%)'
}

function ActivationIllustration() {
  return (
    <div
      aria-hidden
      className="relative flex h-18 items-end justify-center overflow-hidden border-border border-b bg-muted">
      <div className="absolute inset-0" style={DOT_GRID_STYLE} />
      <div className="relative -mb-3 h-19 w-40 origin-bottom scale-[0.8]">
        <div className="absolute inset-x-5 top-0 bottom-0 -rotate-5 rounded-xl bg-popover opacity-60 shadow-lg ring-1 ring-border" />
        <div className="fade-in-0 slide-in-from-bottom-3 absolute inset-x-2 top-2.5 bottom-0 animate-in rounded-lg bg-popover px-1.5 py-2 shadow-lg ring-1 ring-border duration-500 motion-reduce:animate-none">
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <span className="h-1 w-10 rounded-full bg-accent" />
            <span className="h-2 w-5 rounded-full ring-1 ring-border" />
          </div>
          <div className="relative flex h-5.5 items-center gap-1.5 rounded-md bg-accent px-1.5">
            <span className="absolute top-[22%] left-0 h-[56%] w-0.5 rounded-full bg-primary" />
            <span className="size-3 rounded-full bg-border-strong" />
            <span className="h-1 w-18 rounded-full bg-border-strong" />
            <span className="ml-auto grid size-3.5 place-items-center rounded-full bg-foreground text-background">
              <Check size={8} strokeWidth={3.4} />
            </span>
          </div>
          {[56, 64].map((width) => (
            <div key={width} className="flex h-5.5 items-center gap-1.5 px-1.5">
              <span className="size-3 rounded-full bg-accent" />
              <span className="h-1 rounded-full bg-accent" style={{ width }} />
            </div>
          ))}
        </div>
        <svg viewBox="0 0 24 24" className="absolute top-0 -right-3 size-3 fill-muted-foreground">
          <path d={SPARKLE_PATH} />
        </svg>
        <svg viewBox="0 0 24 24" className="absolute top-6 -left-2.5 size-2 fill-muted-foreground opacity-60">
          <path d={SPARKLE_PATH} />
        </svg>
      </div>
    </div>
  )
}
