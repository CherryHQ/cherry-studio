import { TopView } from '@renderer/components/TopView'
import { useProvider } from '@renderer/hooks/useProvider'
import ModelEditContent from '@renderer/pages/settings/ProviderSettings/EditModelPopup/ModelEditContent'
import type { Model, Provider } from '@renderer/types'
import React, { useCallback, useState } from 'react'

interface ShowParams {
  provider: Provider
  model: Model
}

interface Props extends ShowParams {
  resolve: (data?: Model) => void
}

const PopupContainer: React.FC<Props> = ({ provider: _provider, model, resolve }) => {
  const [open, setOpen] = useState(true)
  const { provider, updateProvider, models } = useProvider(_provider.id)

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
    (updatedModel: Model) => {
      const updatedModels = models.map((m) => (m.id === updatedModel.id ? updatedModel : m))
      updateProvider({ models: updatedModels })
    },
    [models, updateProvider]
  )

  if (!provider) {
    return null
  }

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
    return new Promise<Model | undefined>((resolve) => {
      TopView.show(<PopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
