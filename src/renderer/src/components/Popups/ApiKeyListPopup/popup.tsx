import { TopView } from '@renderer/components/TopView'
import { isPreprocessProviderId, isWebSearchProviderId } from '@renderer/types'
import { Modal } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DocPreprocessApiKeyList, LlmApiKeyList, WebSearchApiKeyList } from './list'

interface ShowParams {
  providerId: string
  title?: string
  showHealthCheck?: boolean
}

interface Props extends ShowParams {
  resolve: (value: any) => void
}

/**
 * API Key 列表弹窗容器组件
 */
const PopupContainer: React.FC<Props> = ({ providerId, title, resolve, showHealthCheck = true }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  const ListComponent = useMemo(() => {
    if (isWebSearchProviderId(providerId)) {
      return <WebSearchApiKeyList providerId={providerId} showHealthCheck={showHealthCheck} />
    }
    if (isPreprocessProviderId(providerId)) {
      return <DocPreprocessApiKeyList providerId={providerId} showHealthCheck={showHealthCheck} />
    }
    return <LlmApiKeyList providerId={providerId} showHealthCheck={showHealthCheck} />
  }, [providerId, showHealthCheck])

  return (
    <Modal
      title={title || t('settings.provider.api.key.list.title')}
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      width={600}
      footer={null}>
      {ListComponent}
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
