import { TopView } from '@renderer/components/TopView'
import { Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ApiKeyList from './list'

interface ShowParams {
  providerId: string
  title?: string
}

interface Props extends ShowParams {
  resolve: (value: any) => void
}

/**
 * API Key 列表弹窗容器组件
 * 重构后简化接口，ApiKeyList 直接与 store 交互
 */
const PopupContainer: React.FC<Props> = ({ providerId, title, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const onOk = () => {
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve({})
  }

  // 设置静态 hide 方法
  ApiKeyListPopup.hide = onCancel

  return (
    <Modal
      title={title || t('settings.provider.api.key.list.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      width={600}
      footer={null}>
      <ApiKeyList providerId={providerId} />
    </Modal>
  )
}

const TopViewKey = 'ApiKeyListPopup'

export default class ApiKeyListPopup {
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
