import { useModelMutations } from '@renderer/hooks/useModels'
import { useModels } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '@renderer/pages/settings/ProviderSettingsV2/hooks/providerSetting/constants'
import { useProviderModelSync } from '@renderer/pages/settings/ProviderSettingsV2/hooks/useProviderModelSync'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DownloadOVMSModelPopup from './DownloadOVMSModelPopup'

type UseModelListActionsInput = {
  providerId: string
}

export const useModelListActions = ({ providerId }: UseModelListActionsInput) => {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { updateModel } = useModelMutations()
  const { isSyncingModels } = useProviderModelSync(providerId, { existingModels: models })
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [manageModelsOpen, setManageModelsOpen] = useState(false)
  const [modelListSyncOpen, setModelListSyncOpen] = useState(false)
  /** When true, `ManageModelsDrawer` opens the inline custom-add row (toolbar “Add”). */
  const [openManageWithInlineCustomAdd, setOpenManageWithInlineCustomAdd] = useState(false)

  const openManageModels = useCallback(() => {
    if (provider) {
      setOpenManageWithInlineCustomAdd(false)
      setManageModelsOpen(true)
    }
  }, [provider])

  const openModelListSync = useCallback(() => {
    if (!provider) {
      return
    }
    setModelListSyncOpen(true)
  }, [provider])

  const closeManageModels = useCallback(() => {
    setManageModelsOpen(false)
    setOpenManageWithInlineCustomAdd(false)
  }, [])

  const closeModelListSync = useCallback(() => {
    setModelListSyncOpen(false)
  }, [])

  const consumeOpenManageWithInlineCustomAdd = useCallback(() => {
    setOpenManageWithInlineCustomAdd(false)
  }, [])

  const onRefreshModels = useCallback(() => {
    openModelListSync()
  }, [openModelListSync])

  const onAddModel = useCallback(() => {
    if (!provider) {
      return
    }

    setOpenManageWithInlineCustomAdd(false)
    setManageModelsOpen(true)
  }, [provider])

  const onDownloadModel = useCallback(() => {
    if (provider) {
      void DownloadOVMSModelPopup.show({ title: t('ovms.download.title'), provider })
    }
  }, [provider, t])

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
    modelListSyncOpen,
    openManageWithInlineCustomAdd,
    consumeOpenManageWithInlineCustomAdd,
    openManageModels,
    openModelListSync,
    closeModelListSync,
    closeManageModels,
    onRefreshModels,
    onAddModel,
    onDownloadModel,
    updateVisibleModelsEnabledState,
    isBulkUpdating,
    isSyncingModels
  }
}

export type ModelListActionsSurface = ReturnType<typeof useModelListActions>
