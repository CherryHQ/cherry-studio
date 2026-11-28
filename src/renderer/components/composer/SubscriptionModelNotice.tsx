import { Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { CherryCloudModelSelector } from '@renderer/components/cherryCloud/CherryCloudModelSelector'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { useHasCurrentPaidPlan } from '@renderer/hooks/cherryCloud/useHasCurrentPaidPlan'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'

interface Props {
  /** The latest reply failed at another provider in a way a subscription model can get past. */
  providerFailed: boolean
  currentModel?: Model
  /** The composer's own model-picker constraints; the notice narrows them to subscription models. */
  filter?: ModelSelectorFilter
  includeAgentOnlyModels?: boolean
  onSelect: (model: Model | undefined) => void
}

/** Sits above the composer input and offers a paid subscriber a subscription model after a provider failure. */
export function SubscriptionModelNotice({
  providerFailed,
  currentModel,
  filter,
  includeAgentOnlyModels,
  onSelect
}: Props) {
  const { t } = useTranslation()
  const suggested = providerFailed && currentModel?.providerId !== CHERRY_CLOUD_PROVIDER_ID
  const hasPaidPlan = useHasCurrentPaidPlan(suggested)
  const [pickerMounted, setPickerMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const subscriptionFilter = useCallback<ModelSelectorFilter>(
    (model, provider) => model.providerId === CHERRY_CLOUD_PROVIDER_ID && (filter?.(model, provider) ?? true),
    [filter]
  )

  if (!suggested || !hasPaidPlan) return null

  const trigger = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={
        pickerMounted
          ? undefined
          : () => {
              setPickerMounted(true)
              setOpen(true)
            }
      }>
      {t('chat.input.subscription_notice.switch')}
    </Button>
  )

  return (
    <div
      role="status"
      data-ui="chat.composer.subscription-notice"
      className="relative mx-2 mb-1.5 flex items-center gap-2 border-[0.5px] border-border p-1.5 pl-3 backdrop-blur"
      style={{ borderRadius: 16, backgroundColor: 'color-mix(in srgb, var(--background) 88%, transparent)' }}>
      <Sparkles className="size-3.5 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1 truncate text-xs text-foreground">
        {t('chat.input.subscription_notice.message')}
      </div>
      {pickerMounted ? (
        <CherryCloudModelSelector
          multiple={false}
          open={open}
          onOpenChange={setOpen}
          filter={subscriptionFilter}
          includeAgentOnlyModels={includeAgentOnlyModels}
          // Sign-in, AMD and subscribe rows start their own flows instead of switching this conversation.
          showSubscriptionOffers={false}
          onSelect={onSelect}
          side="top"
          align="end"
          trigger={trigger}
        />
      ) : (
        trigger
      )}
    </div>
  )
}
