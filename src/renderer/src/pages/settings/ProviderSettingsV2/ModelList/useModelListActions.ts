import { useModelMutations } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import i18n from '@renderer/i18n'
import { useProviderModelSync } from '@renderer/pages/settings/ProviderSettingsV2/hooks/useProviderModelSync'
import { isNewApiProvider } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { useCallback, useState } from 'react'

import AddModelPopup from './AddModelPopup'
import DownloadOVMSModelPopup from './DownloadOVMSModelPopup'
import NewApiAddModelPopup from './NewApiAddModelPopup'

type UseModelListActionsInput = {
  providerId: string
  models: Model[]
}

export const useModelListActions = ({ providerId, models }: UseModelListActionsInput) => {
  const { provider } = useProvider(providerId)
  const { updateModel } = useModelMutations()
  const { syncProviderModels, isSyncingModels } = useProviderModelSync(providerId, { existingModels: models })
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [manageModelsOpen, setManageModelsOpen] = useState(false)

  const openManageModels = useCallback(() => {
    if (provider) {
      setManageModelsOpen(true)
    }
  }, [provider])

  const closeManageModels = useCallback(() => {
    setManageModelsOpen(false)
  }, [])

  const onRefreshModels = useCallback(() => {
    if (provider) {
      void syncProviderModels(provider)
    }
  }, [provider, syncProviderModels])

  const onAddModel = useCallback(() => {
    if (!provider) {
      return
    }

    if (isNewApiProvider(provider)) {
      void NewApiAddModelPopup.show({ title: i18n.t('settings.models.add.add_model'), provider })
      return
    }

    void AddModelPopup.show({ title: i18n.t('settings.models.add.add_model'), provider })
  }, [provider])

  const onDownloadModel = useCallback(() => {
    if (provider) {
      void DownloadOVMSModelPopup.show({ title: i18n.t('ovms.download.title'), provider })
    }
  }, [provider])

  const updateVisibleModelsEnabledState = useCallback(
    async (visibleModels: Model[], enabled: boolean) => {
      const targetModels = visibleModels.filter((model) => model.isEnabled !== enabled)

      if (targetModels.length === 0) {
        return
      }

      setIsBulkUpdating(true)

      try {
        await Promise.all(
          targetModels.map((model) => {
            const { modelId } = parseUniqueModelId(model.id)
            return updateModel(model.providerId, modelId, { isEnabled: enabled })
          })
        )
      } finally {
        setIsBulkUpdating(false)
      }
    },
    [updateModel]
  )

  return {
    manageModelsOpen,
    openManageModels,
    closeManageModels,
    onRefreshModels,
    onAddModel,
    onDownloadModel,
    updateVisibleModelsEnabledState,
    isBulkUpdating,
    isSyncingModels
  }
}
