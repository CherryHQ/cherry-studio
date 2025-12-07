import { TopView } from '@renderer/components/TopView'
import { useAssistants, useDefaultModel } from '@renderer/hooks/useAssistant'
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
  const { assistants, updateAssistants } = useAssistants()
  const { defaultModel, setDefaultModel, translateModel, setTranslateModel, quickModel, setQuickModel } =
    useDefaultModel()

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

      updateAssistants(
        assistants.map((a) => {
          let model = a.model
          let defaultModel = a.defaultModel
          if (a.model?.id === updatedModel.id && a.model.provider === provider.id) {
            model = updatedModel
          }
          if (a.defaultModel?.id === updatedModel.id && a.defaultModel?.provider === provider.id) {
            defaultModel = updatedModel
          }
          return { ...a, model, defaultModel }
        })
      )

      if (defaultModel?.id === updatedModel.id && defaultModel?.provider === provider.id) {
        setDefaultModel(updatedModel)
      }
      if (translateModel?.id === updatedModel.id && translateModel?.provider === provider.id) {
        setTranslateModel(updatedModel)
      }
      if (quickModel?.id === updatedModel.id && quickModel?.provider === provider.id) {
        setQuickModel(updatedModel)
      }
    },
    [
      models,
      updateProvider,
      updateAssistants,
      assistants,
      defaultModel?.id,
      defaultModel?.provider,
      provider.id,
      translateModel?.id,
      translateModel?.provider,
      quickModel?.id,
      quickModel?.provider,
      setDefaultModel,
      setTranslateModel,
      setQuickModel
    ]
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
