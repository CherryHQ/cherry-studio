import { first } from 'es-toolkit/compat'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import {
  ModelSelector,
  ModelSelectorDetailCardContent,
  getProviderDisplayName,
  type ModelSelectorActionItem,
  type ModelSelectorProps
} from '@renderer/components/ModelSelector'
import { ModelTag, SubscriptionTag } from '@renderer/components/tags/Model'
import { useModels } from '@renderer/hooks/useModel'
import { useProviders } from '@renderer/hooks/useProvider'
import { startCherryCloudSubscription } from '@renderer/services/cherryCloudSubscription'
import { trackSubscriptionEntryView } from '@renderer/services/cherryCloudSubscriptionAnalytics'
import { getModelLogoRef } from '@renderer/utils/model'
import { CHERRY_CLOUD_PROVIDER_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { SubscriptionEntrySource } from '@shared/ipc/schemas/cherryCloud'

import {
  CHERRY_CLOUD_SELECTOR_PROVIDER_IDS,
  isCherryCloudChatOffer,
  useCherryCloudModelSelectorOffers,
  useCherryCloudModelSelectorPolicy,
  type CherryCloudOfferFilter
} from './useCherryCloudModelSelectorData'

type WithoutComposition<T> = T extends unknown ? Omit<T, 'composition'> : never
export type CherryCloudModelSelectorProps = WithoutComposition<ModelSelectorProps> & {
  offerFilter?: CherryCloudOfferFilter
  showSubscriptionOffers?: boolean
}

function EntryView({ open, source }: { open: boolean; source: SubscriptionEntrySource }) {
  useEffect(() => {
    if (open) trackSubscriptionEntryView(source)
  }, [open, source])
  return null
}

function OfferIcon({ id, name }: { id: string; name: string }) {
  const icon = useIcon(getModelLogoRef({ id, name }, CHERRY_CLOUD_PROVIDER_ID))
  return icon ? (
    <icon.Avatar size={24} className="border border-border" />
  ) : (
    <Avatar size="sm" className="border border-border">
      <AvatarFallback>{first(name) || 'M'}</AvatarFallback>
    </Avatar>
  )
}

/** Composes Cloud entitlement and subscription presentation around the domain-blind selector. */
export function CherryCloudModelSelector(props: CherryCloudModelSelectorProps) {
  const { offerFilter = isCherryCloudChatOffer, showSubscriptionOffers = true, ...selectorProps } = props
  const { filter, includeAgentOnlyModels } = props
  const [internalOpen, setInternalOpen] = useState(false)
  const open = props.open ?? internalOpen
  const [activated, setActivated] = useState(open)
  const enabled = open || (props.mountStrategy === 'lazy-keep' && activated)
  useEffect(() => {
    if (open) setActivated(true)
  }, [open])
  const { t } = useTranslation()
  const { modelFilter, getModelPresentation, availability, prioritizedProviderIds } = useCherryCloudModelSelectorPolicy(
    {
      enabled,
      includeAgentOnlyModels: includeAgentOnlyModels,
      filter: filter,
      prioritizedProviderIds: props.prioritizedProviderIds
    }
  )
  const { offers, paidPlan, canOfferSubscription, signedOut } = useCherryCloudModelSelectorOffers(
    enabled,
    includeAgentOnlyModels ?? false,
    offerFilter,
    showSubscriptionOffers
  )
  const { isAvailabilityReady, isModelHidden } = availability
  const { providers } = useProviders({ enabled: true }, { enabled })
  const { models } = useModels({ enabled: true }, { fetchEnabled: enabled })
  const provider =
    providers.find((item) => item.id === CHERRY_CLOUD_PROVIDER_ID) ??
    providers.find((item) => item.id === CHERRYAI_PROVIDER_ID)
  const onOpenChange = (next: boolean) => {
    if (props.open === undefined) setInternalOpen(next)
    props.onOpenChange?.(next)
  }
  const subscribe = () => {
    onOpenChange(false)
    void startCherryCloudSubscription('selector_header')
  }
  const subscribeEntry = canOfferSubscription ? (
    <>
      <EntryView open={open} source="selector_header" />
      <button
        type="button"
        className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-link hover:underline"
        onClick={(event) => {
          event.stopPropagation()
          subscribe()
        }}>
        {t('settings.subscription.go_to_subscribe')}
      </button>
    </>
  ) : null
  const actions = useMemo<ModelSelectorActionItem[]>(
    () =>
      !provider || (!isAvailabilityReady && !signedOut)
        ? []
        : offers.flatMap(({ offer, modelId, tags }) => {
            const owned = models.some(
              (model) =>
                model.id === modelId &&
                !isModelHidden(model, includeAgentOnlyModels ?? false) &&
                (filter?.(model, provider) ?? true)
            )
            if (owned) return []
            return [
              {
                key: `offer-${modelId}`,
                type: 'action',
                groupId: CHERRYAI_PROVIDER_ID,
                providerId: CHERRY_CLOUD_PROVIDER_ID,
                label: offer.display_name,
                searchId: modelId,
                tags,
                leading: <OfferIcon id={modelId} name={offer.display_name} />,
                trailing: (
                  <div className="ml-2 flex h-[18px] max-w-[65%] shrink-0 items-center justify-end gap-1 overflow-hidden">
                    <EntryView open={open} source="selector_locked_row" />
                    <SubscriptionTag size={9} className="h-full" />
                    {tags.map((tag) => (
                      <ModelTag
                        key={tag}
                        tag={tag}
                        size={9}
                        showLabel={false}
                        showTooltip
                        className="h-full items-center"
                      />
                    ))}
                  </div>
                ),
                detail: (
                  <ModelSelectorDetailCardContent
                    name={offer.display_name}
                    modelIdentifier={offer.id}
                    providerName={getProviderDisplayName(provider)}
                    tags={tags}
                  />
                ),
                onAction: () => {
                  void startCherryCloudSubscription('selector_locked_row', { modelId })
                }
              }
            ]
          }),
    [isAvailabilityReady, isModelHidden, models, offers, open, signedOut, filter, includeAgentOnlyModels, provider]
  )
  const composition = {
    getModelPresentation,
    actions,
    providerGroups: [
      {
        id: CHERRYAI_PROVIDER_ID,
        providerIds: CHERRY_CLOUD_SELECTOR_PROVIDER_IDS,
        trailing: paidPlan ? (
          <span className="truncate rounded-full border border-border px-1.5 font-medium text-[10px] text-foreground leading-4">
            {paidPlan.plan.display_name}
          </span>
        ) : (
          subscribeEntry
        )
      }
    ],
    emptyContent: subscribeEntry
  }
  return (
    <ModelSelector
      {...selectorProps}
      open={open}
      onOpenChange={onOpenChange}
      filter={modelFilter}
      prioritizedProviderIds={prioritizedProviderIds}
      composition={composition}
    />
  )
}
