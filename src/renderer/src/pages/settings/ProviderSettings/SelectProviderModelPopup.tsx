import { modelSelectFilter, modelSelectOptionsFlat } from '@renderer/components/SelectOptions'
import { TopView } from '@renderer/components/TopView'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import i18n from '@renderer/i18n'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Provider } from '@renderer/types'
import { Modal, Select } from 'antd'
import { first } from 'lodash'
import { useMemo, useState } from 'react'

interface ShowParams {
  provider: Provider
}

interface Props extends ShowParams {
  reject: (reason?: any) => void
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ provider, resolve, reject }) => {
  const [open, setOpen] = useState(true)
  const [model, setModel] = useState(first(provider.models))

  const modelOptions = useMemo(() => {
    return modelSelectOptionsFlat([provider], (m) => !isEmbeddingModel(m) && !isRerankModel(m), false)
  }, [provider])

  const defaultModelValue = useMemo(() => {
    return model ? getModelUniqId(model) : undefined
  }, [model])

  const onOk = () => {
    if (!model) {
      window.message.error({ content: i18n.t('message.error.enter.model'), key: 'api-check' })
      return
    }
    setOpen(false)
    resolve(model)
  }

  const onCancel = () => {
    setOpen(false)
    setTimeout(reject, 300)
  }

  const onClose = () => {
    TopView.hide(TopViewKey)
  }

  SelectProviderModelPopup.hide = onCancel

  return (
    <Modal
      title={i18n.t('message.api.check.model.title', { model: model })}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      width={400}
      centered>
      <Select
        defaultValue={defaultModelValue}
        placeholder={i18n.t('settings.models.empty')}
        options={modelOptions}
        style={{ width: '100%' }}
        showSearch
        onChange={(value) => {
          setModel(provider.models.find((m) => value === getModelUniqId(m))!)
        }}
        filterOption={modelSelectFilter}
      />
    </Modal>
  )
}

const TopViewKey = 'SelectProviderModelPopup'

export default class SelectProviderModelPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve, reject) => {
      TopView.show(
        <PopupContainer
          {...props}
          reject={() => {
            reject()
            TopView.hide(TopViewKey)
          }}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
