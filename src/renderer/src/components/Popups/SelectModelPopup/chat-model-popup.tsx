import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import { useModels } from '@renderer/hooks/useModels'
import { useProviders as useV2Providers } from '@renderer/hooks/useProviders'
import { toV1ModelShim, toV1ProviderShim } from '@renderer/pages/settings/ProviderSettings/utils/v1ProviderShim'
import type { Model, Provider } from '@renderer/types'
import { groupBy } from 'lodash'
import React, { useMemo } from 'react'

import SelectModelPopupView, { createModelPopup } from './base-popup'

interface PopupParams {
  model?: Model
  filter?: (model: Model) => boolean
  showTagFilter?: boolean
}

interface Props extends PopupParams {
  resolve: (value: Model | undefined) => void
}

/** Exported for unit tests so they can render the container directly without
 *  routing through the TopView popup machinery. Production code uses
 *  `SelectChatModelPopup.show(...)` (declared below). */
export const PopupContainer: React.FC<Props> = ({ model, filter, showTagFilter = true, resolve }) => {
  // v2 DataApi is the source of truth post-T-008C. The picker UI still consumes
  // v1-shape Provider/Model so downstream callers (Chat.tsx, MessageMenubar,
  // assistant.model storage, sendMessage path) need zero changes — the v2→v1
  // shims live in v1ProviderShim.ts and produce raw model.id + provider fields
  // that today's filters, getModelUniqId, and assistant.model consumers expect.
  const { providers: v2Providers } = useV2Providers({ enabled: true })
  const { models: v2Models } = useModels({ enabled: true })

  const filteredProviders = useMemo<Provider[]>(() => {
    const v2ModelsByProvider = groupBy(v2Models, 'providerId')

    const fromV2: Provider[] = v2Providers.reduce<Provider[]>((result, v2Provider) => {
      const v2ProviderModels = v2ModelsByProvider[v2Provider.id] ?? []
      // user_provider.isEnabled and user_model.isEnabled are independent — the
      // backend can return an enabled model under a disabled provider. The
      // picker only shows currently-usable models, so we keep both gates.
      const v1Models = v2ProviderModels.filter((m) => !m.isHidden).map(toV1ModelShim)
      const filteredModels = filter ? v1Models.filter(filter) : v1Models
      if (filteredModels.length === 0) return result
      result.push({ ...toV1ProviderShim(v2Provider), models: filteredModels })
      return result
    }, [])

    // CHERRYAI Qwen fallback — keep until v2 catalog seeds a cherryai user_model
    // row. Without this, fresh installs lose the only model visible by default,
    // which used to appear via the v1 selector's hardcoded concat. T-008B(A).
    const hasCherryai = fromV2.some((p) => p.id === 'cherryai' && p.models.length > 0)
    if (hasCherryai) return fromV2

    const cherryaiModels = filter ? CHERRYAI_PROVIDER.models.filter(filter) : CHERRYAI_PROVIDER.models
    if (cherryaiModels.length === 0) return fromV2
    return [...fromV2, { ...CHERRYAI_PROVIDER, models: cherryaiModels }]
  }, [v2Providers, v2Models, filter])

  return (
    <SelectModelPopupView
      providers={filteredProviders}
      model={model}
      showTagFilter={showTagFilter}
      showPinnedModels={true}
      resolve={resolve}
    />
  )
}

export const SelectChatModelPopup = createModelPopup<PopupParams, Model>(PopupContainer)
