import { TopView } from '@renderer/components/TopView'
import { Modal } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DocPreprocessApiKeyList, LlmApiKeyList, WebSearchApiKeyList } from './list'
import { ApiProviderKind } from './types'

interface ShowParams {
  providerId: string
  providerKind: ApiProviderKind
  title?: string
  showHealthCheck?: boolean
}

interface Props extends ShowParams {
  resolve: (value: any) => void
}

/**
 * API Key 列表弹窗容器组件
 */
const PopupContainer: React.FC<Props> = ({ providerId, providerKind, title, resolve, showHealthCheck = true }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = () => {
    resolve(null)
  }

  const ListComponent = useMemo(() => {
    switch (providerKind) {
      case 'llm':
        return LlmApiKeyList
      case 'websearch':
        return WebSearchApiKeyList
      case 'doc-preprocess':
        return DocPreprocessApiKeyList
      default:
        return null
    }
  }, [providerKind])

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
      {ListComponent && (
        <ListComponent providerId={providerId} providerKind={providerKind} showHealthCheck={showHealthCheck} />
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
