import { useModelMutations } from '@data/hooks/useModels'
import { TopView } from '@renderer/components/TopView'
import ModelEditContent from '@renderer/pages/settings/ProviderSettings/EditModelPopup/ModelEditContent'
import { parseUniqueModelId } from '@shared/data/types/model'
import React, { useCallback, useState } from 'react'

interface ShowParams {
  provider: any
  model: any
}

interface Props extends ShowParams {
  resolve: (data?: any) => void
}

const PopupContainer: React.FC<Props> = ({ provider, model, resolve }) => {
  const [open, setOpen] = useState(true)
  const { patchModel } = useModelMutations()

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
    async (updatedModel: any) => {
      // v2: single PATCH, no cascade updates needed
      // Assistants reference models by UniqueModelId string, not embedded objects
      // Preferences store UniqueModelId strings for default/quick/translate models
      const { modelId } = parseUniqueModelId(updatedModel.id)
      await patchModel(updatedModel.providerId ?? provider.id, modelId, {
        name: updatedModel.name,
        group: updatedModel.group,
        capabilities: updatedModel.capabilities,
        supportsStreaming: updatedModel.supportsStreaming ?? updatedModel.supported_text_delta,
        endpointTypes:
          updatedModel.endpointTypes ?? (updatedModel.endpoint_type ? [updatedModel.endpoint_type] : undefined),
        pricing: updatedModel.pricing
      })
    },
    [provider.id, patchModel]
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
