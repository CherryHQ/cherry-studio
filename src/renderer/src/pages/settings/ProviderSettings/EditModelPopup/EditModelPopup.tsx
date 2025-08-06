import { TopView } from '@renderer/components/TopView'
import { useAssistants, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import ModelEditContent from '@renderer/pages/settings/ProviderSettings/EditModelPopup/ModelEditContent'
import { useAppDispatch } from '@renderer/store'
import { setModel } from '@renderer/store/assistants'
import { Model, Provider } from '@renderer/types'
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
  const { assistants } = useAssistants()
  const { defaultModel, setDefaultModel } = useDefaultModel()
  const dispatch = useAppDispatch()

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

      assistants.forEach((assistant) => {
        if (assistant?.model?.id === updatedModel.id && assistant.model.provider === provider.id) {
          dispatch(
            setModel({
              assistantId: assistant.id,
              model: updatedModel
            })
          )
        }
      })

      if (defaultModel?.id === updatedModel.id && defaultModel?.provider === provider.id) {
        setDefaultModel(updatedModel)
      }
    },
    [models, updateProvider, provider.id, assistants, defaultModel, dispatch, setDefaultModel]
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
    return new Promise<Model | undefined>((resolve) => {
      TopView.show(<PopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
