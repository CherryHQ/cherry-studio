import { Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NutstorePathSelector } from '../NutstorePathSelector'
import { TopView } from '../TopView'

interface Props {
  fs: Nutstore.Fs
  resolve: (data: string | null) => void
}

const PopupContainer: React.FC<Props> = ({ resolve, fs }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  return (
    <Modal
      open={open}
      title={t('settings.data.nutstore.pathSelector.title')}
      transitionName="animation-move-down"
      afterClose={onClose}
      onCancel={onClose}
      footer={null}
      centered>
      <NutstorePathSelector fs={fs} onConfirm={resolve} onCancel={onCancel} />
    </Modal>
  )
}

const TopViewKey = 'NutstorePathPopup'

export default class NutstorePathPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(fs: Nutstore.Fs) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          fs={fs}
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
