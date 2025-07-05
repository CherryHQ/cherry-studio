import { TopView } from '@renderer/components/TopView'
import { Modal } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DocPreprocessApiKeyList, LlmApiKeyList, WebSearchApiKeyList } from './list'
import { ApiKeySourceType } from './types'

interface ShowParams {
  providerId: string
  providerType: ApiKeySourceType
  title?: string
  showHealthCheck?: boolean
}

interface Props extends ShowParams {
  resolve: (value: any) => void
}

/**
 * API Key 列表弹窗容器组件
 */
const PopupContainer: React.FC<Props> = ({ providerId, providerType, title, resolve, showHealthCheck = true }) => {
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

  const ListComponent = useMemo(() => {
    switch (providerType) {
      case 'llm-provider':
        return LlmApiKeyList
      case 'websearch-provider':
        return WebSearchApiKeyList
      case 'doc-preprocess-provider':
        return DocPreprocessApiKeyList
      default:
        return null
    }
  }, [providerType])

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
      {ListComponent && (
        <ListComponent providerId={providerId} providerType={providerType} showHealthCheck={showHealthCheck} />
      )}
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
      TopView.show(<PopupContainer {...props} resolve={(v) => resolve(v)} />, TopViewKey)
    })
  }
}
