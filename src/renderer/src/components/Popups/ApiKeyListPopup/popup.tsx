import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { isPreprocessProviderId, isWebSearchProviderId } from '@renderer/types'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DocPreprocessApiKeyList, LlmApiKeyList, WebSearchApiKeyList } from './list'

const CLOSE_ANIMATION_MS = 200

interface ShowParams {
  providerId: string
  title?: string
  showHealthCheck?: boolean
  providerType?: 'llm' | 'webSearch' | 'preprocess'
}

interface Props extends ShowParams {
  resolve: (value: any) => void
}

/**
 * API Key 列表弹窗容器组件
 */
const PopupContainer: React.FC<Props> = ({ providerId, title, resolve, showHealthCheck = true, providerType }) => {
  const [open, setOpen] = useState(true)
  const resolvedRef = useRef(false)
  const { t } = useTranslation()

  const resolveAfterClose = () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    window.setTimeout(() => {
      resolve(null)
    }, CLOSE_ANIMATION_MS)
  }

  const closePopup = () => {
    setOpen(false)
    resolveAfterClose()
  }

  const onOpenChange = (next: boolean) => {
    if (!next) {
      closePopup()
    }
  }

  const dialogTitle = title || t('settings.provider.api.key.list.title')

  const ListComponent = useMemo(() => {
    const type =
      providerType ||
      (isWebSearchProviderId(providerId) ? 'webSearch' : isPreprocessProviderId(providerId) ? 'preprocess' : 'llm')

    switch (type) {
      case 'webSearch':
        return <WebSearchApiKeyList providerId={providerId as any} showHealthCheck={showHealthCheck} />
      case 'preprocess':
        return <DocPreprocessApiKeyList providerId={providerId as any} showHealthCheck={showHealthCheck} />
      case 'llm':
      default:
        return <LlmApiKeyList providerId={providerId} showHealthCheck={showHealthCheck} />
    }
  }, [providerId, showHealthCheck, providerType])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        {ListComponent}
      </DialogContent>
    </Dialog>
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
