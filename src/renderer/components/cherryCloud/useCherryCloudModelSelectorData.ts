import { uniqBy } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo } from 'react'
import useSWR from 'swr'

import { usePersistCache } from '@data/hooks/useCache'
import {
  useModelSelectorData,
  type ModelSelectorFilter,
  type UseModelSelectorDataOptions
} from '@renderer/components/ModelSelector'
import { getModelDisplayTags, MODEL_DISPLAY_CAPABILITY_TAGS } from '@renderer/components/tags/Model'
import { useCherryCloudModelAvailability } from '@renderer/hooks/useCherryCloudModelAvailability'
import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { CHERRY_CLOUD_PROVIDER_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createUniqueModelId, MODEL_CAPABILITY, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CherryCloudPlanModel } from '@shared/ipc/schemas/cherryCloud'

export type CherryCloudOfferFilter = (offer: CherryCloudPlanModel) => boolean

export const CHERRY_CLOUD_SELECTOR_PROVIDER_IDS = [CHERRYAI_PROVIDER_ID, CHERRY_CLOUD_PROVIDER_ID] as const
const NON_CHAT_CAPABILITIES = new Set<string>([
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK,
  MODEL_CAPABILITY.IMAGE_GENERATION,
  MODEL_CAPABILITY.VIDEO_GENERATION,
  MODEL_CAPABILITY.AUDIO_GENERATION,
  MODEL_CAPABILITY.AUDIO_TRANSCRIPT
])

export const isCherryCloudChatOffer: CherryCloudOfferFilter = (offer) =>
  !(offer.capabilities ?? []).some((capability) => NON_CHAT_CAPABILITIES.has(capability))

export function useCherryCloudModelSelectorPolicy({
  enabled = true,
  includeAgentOnlyModels = false,
  filter,
  prioritizedProviderIds = []
}: Pick<UseModelSelectorDataOptions, 'enabled' | 'includeAgentOnlyModels' | 'filter' | 'prioritizedProviderIds'>) {
  const availability = useCherryCloudModelAvailability(enabled)
  const { activePaid, upcomingPaid } = useCherryCloudPlans(enabled)
  const { providers } = useProviders({ enabled: true }, { enabled })
  const hasPaidPlan = Boolean(activePaid || upcomingPaid)
  const orderedProviderIds = useMemo(() => {
    const otherProviderIds = prioritizedProviderIds.filter(
      (id) => !CHERRY_CLOUD_SELECTOR_PROVIDER_IDS.some((cloudId) => cloudId === id)
    )
    return hasPaidPlan
      ? [...CHERRY_CLOUD_SELECTOR_PROVIDER_IDS, ...otherProviderIds]
      : [
          ...otherProviderIds,
          ...providers
            .filter((provider) => !CHERRY_CLOUD_SELECTOR_PROVIDER_IDS.some((id) => id === provider.id))
            .map((provider) => provider.id),
          ...CHERRY_CLOUD_SELECTOR_PROVIDER_IDS
        ]
  }, [hasPaidPlan, prioritizedProviderIds, providers])
  const { isModelHidden, isModelFree, getModelDescription, isModelUnavailable } = availability
  const modelFilter = useCallback<ModelSelectorFilter>(
    (model, provider) => !isModelHidden(model, includeAgentOnlyModels) && (filter?.(model, provider) ?? true),
    [isModelHidden, filter, includeAgentOnlyModels]
  )
  const getModelPresentation = useCallback(
    (model: Model, provider: Provider) => {
      const staticTags = getModelDisplayTags(model, undefined, provider)
      const tags = isModelFree(model) && !staticTags.includes('free') ? [...staticTags, 'free' as const] : staticTags
      return {
        tags,
        description: getModelDescription(model),
        disabled: isModelUnavailable(model),
        priority: isModelFree(model) ? 1 : 0
      }
    },
    [getModelDescription, isModelFree, isModelUnavailable]
  )
  return { availability, modelFilter, getModelPresentation, prioritizedProviderIds: orderedProviderIds }
}

/** Cloud-aware resolution for consumers that classify saved selections without rendering a picker. */
export function useCherryCloudModelSelectorData(options: UseModelSelectorDataOptions) {
  const { availability, modelFilter, getModelPresentation, prioritizedProviderIds } =
    useCherryCloudModelSelectorPolicy(options)
  const composition = useMemo(
    () => ({
      getModelPresentation,
      providerGroups: [{ id: CHERRYAI_PROVIDER_ID, providerIds: CHERRY_CLOUD_SELECTOR_PROVIDER_IDS }]
    }),
    [getModelPresentation]
  )
  const data = useModelSelectorData({
    ...options,
    filter: modelFilter,
    prioritizedProviderIds,
    composition
  })
  return {
    ...data,
    cloudAvailabilityReady: availability.isAvailabilityReady,
    cloudAvailabilityError: availability.availabilityError
  }
}

export function useCherryCloudModelSelectorOffers(
  enabled: boolean,
  includeAgentOnlyModels: boolean,
  offerFilter: CherryCloudOfferFilter,
  showOffers: boolean
) {
  const { session, plansQuery, activePaid, upcomingPaid, isPlansReady } = useCherryCloudPlans(enabled)
  const [cachedPlanModels, setCachedPlanModels] = usePersistCache('ui.cherry_cloud.plan_models')
  const livePlanModels = useMemo(
    () =>
      plansQuery.data &&
      uniqBy(
        plansQuery.data.available_plans.filter((plan) => !plan.is_free).flatMap((plan) => plan.models ?? []),
        (model) => model.id
      ),
    [plansQuery.data]
  )
  useEffect(() => {
    if (livePlanModels && isPlansReady) setCachedPlanModels(livePlanModels)
  }, [isPlansReady, livePlanModels, setCachedPlanModels])
  const signedOut = session.status?.phase === 'signed-out'
  const { data: publicPlans } = useSWR(
    enabled && showOffers && signedOut ? 'cherry-cloud/public-plans' : null,
    () => ipcApi.request('cherry_cloud.public_plans.get'),
    { shouldRetryOnError: false }
  )
  const publicPlanModels = useMemo(
    () =>
      publicPlans &&
      uniqBy(
        publicPlans.plans.filter((plan) => !plan.is_free).flatMap((plan) => plan.models),
        (model) => model.id
      ),
    [publicPlans]
  )
  const paidPlan = activePaid ?? upcomingPaid
  const canOfferSubscription = showOffers && (signedOut || (isPlansReady && !paidPlan))
  const offers = useMemo(() => {
    const planModels = canOfferSubscription
      ? signedOut
        ? (publicPlanModels ?? cachedPlanModels)
        : (livePlanModels ?? [])
      : []
    return planModels
      .filter((model) => {
        const features = new Set(model.available_features)
        return (
          (includeAgentOnlyModels ? features.has('agent') : features.has('chat') && features.has('translate')) &&
          isCherryCloudChatOffer(model) &&
          offerFilter(model)
        )
      })
      .map((offer) => ({
        offer,
        modelId: createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, offer.id),
        tags: MODEL_DISPLAY_CAPABILITY_TAGS.filter((tag) => offer.capabilities?.includes(tag))
      }))
  }, [
    canOfferSubscription,
    signedOut,
    publicPlanModels,
    cachedPlanModels,
    livePlanModels,
    includeAgentOnlyModels,
    offerFilter
  ])
  return { offers, paidPlan, canOfferSubscription, signedOut }
}
