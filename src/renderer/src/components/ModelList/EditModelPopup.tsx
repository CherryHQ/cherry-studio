import ModelEditContent from '@renderer/components/ModelList/ModelEditContent'
import { TopView } from '@renderer/components/TopView'
import { Model, Provider } from '@renderer/types'
import React from 'react'

interface ShowParams {
  provider: Provider
  model: Model
}

interface Props extends ShowParams {
  resolve: (data?: Model) => void
}

const PopupContainer: React.FC<Props> = ({ provider, model, resolve }) => {
  const handleUpdateModel = (updatedModel: Model) => {
    resolve(updatedModel)
  }

  const handleClose = () => {
    resolve(undefined) // Resolve with no data on close
  }

  return (
    <ModelEditContent
      provider={provider}
      model={model}
      onUpdateModel={handleUpdateModel}
      open={true} // Always open when rendered by TopView
      onClose={handleClose}
      key={model.id} // Ensure re-mount when model changes
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
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        TopViewKey
      )
    })
  }
}
