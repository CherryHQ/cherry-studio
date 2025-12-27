import { TopView } from '@renderer/components/TopView'
import { Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import StreamingSettings from './StreamingSettings'

interface ShowParams {
  providerId: string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ providerId, resolve }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  StreamingSettingsPopup.hide = onCancel

  return (
    <Modal
      title={t('settings.provider.streaming.title')}
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      styles={{ body: { padding: '20px 16px' } }}
      footer={null}
      centered>
      <StreamingSettings providerId={providerId} />
    </Modal>
  )
}

const TopViewKey = 'StreamingSettingsPopup'

export default class StreamingSettingsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
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
