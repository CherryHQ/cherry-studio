import { TopView } from '@renderer/components/TopView'
import { useTimer } from '@renderer/hooks/useTimer'
import i18n from '@renderer/i18n'
import { isRerankModel } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import type { Model } from '@shared/data/types/model'
import { Modal, Select } from 'antd'
import { first, sortBy } from 'lodash'
import { useMemo, useState } from 'react'

interface ShowParams {
  models: Model[]
}

interface Props extends ShowParams {
  reject: (reason?: any) => void
  resolve: (data: Model) => void
}

const PopupContainer: React.FC<Props> = ({ models: rawModels, resolve, reject }) => {
  const [open, setOpen] = useState(true)
  const { setTimeoutTimer } = useTimer()

  const models = useMemo(() => rawModels.filter((m) => !isRerankModel(m)), [rawModels])
  const [model, setModel] = useState(first(models))

  const defaultModelValue = useMemo(() => {
    return model?.id
  }, [model])

  const options = useMemo(
    () =>
      sortBy(models, 'name').map((item) => ({
        label: item.name,
        value: item.id
      })),
    [models]
  )

  const onOk = () => {
    if (!model) {
      window.toast.error(i18n.t('message.error.enter.model'))
      return
    }
    setOpen(false)
    resolve(model)
  }

  const onCancel = () => {
    setOpen(false)
    setTimeoutTimer('onCancel', reject, 300)
  }

  const onClose = () => {
    TopView.hide(TopViewKey)
  }

  SelectProviderModelPopup.hide = onCancel

  return (
    <Modal
      title={i18n.t('message.api.check.model.title', { model: model?.name || '' })}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      width={400}
      centered>
      <Select
        showSearch
        defaultValue={defaultModelValue}
        options={options}
        optionFilterProp="label"
        placeholder={i18n.t('settings.models.empty')}
        style={{ width: '100%' }}
        onChange={(value) => {
          setModel(models.find((item) => item.id === value))
        }}
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
    return new Promise<Model | undefined>((resolve, reject) => {
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
