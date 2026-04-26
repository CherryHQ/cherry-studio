import { TopView } from '@renderer/components/TopView'
import { useModelMutations } from '@renderer/hooks/useModels'
import ModelEditContent from '@renderer/pages/settings/ProviderSettingsV2/EditModelPopup/ModelEditContent'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import React, { useCallback, useState } from 'react'

interface ShowParams {
  provider: Provider
  model: Model
}

interface Props extends ShowParams {
  resolve: (data?: any) => void
}

const PopupContainer: React.FC<Props> = ({ provider, model, resolve }) => {
  const [open, setOpen] = useState(true)
  const { updateModel } = useModelMutations()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    EditModelPopup.hide()
    resolve(undefined)
  }

  const onUpdateModel = useCallback(
    async (patch: Partial<Model>) => {
      const { modelId } = parseUniqueModelId(model.id)
      await updateModel(model.providerId ?? provider.id, modelId, {
        name: patch.name,
        group: patch.group,
        capabilities: patch.capabilities,
        supportsStreaming: patch.supportsStreaming,
        endpointTypes: patch.endpointTypes,
        pricing: patch.pricing
      })
    },
    [model.id, model.providerId, provider.id, updateModel]
  )

  return (
    <ModelEditContent
      provider={provider}
      model={model}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      onUpdateModel={onUpdateModel}
    />
  )
}

const TopViewKey = 'EditModelPopup'

export default class EditModelPopup {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(<PopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
