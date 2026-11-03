import type { WebviewTag } from 'electron'
import { LoaderCircle } from 'lucide-react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'

import WebviewSearch from './WebviewSearch'

interface Props {
  webviewRef: RefObject<WebviewTag | null>
  targetId: string
  isReady: boolean
  isLoading: boolean
  recovery?: { message: string; onRecover: () => void }
  errorMessage?: string
}

export function BrowserOverlays({ webviewRef, targetId, isReady, isLoading, errorMessage, recovery }: Props) {
  const { t } = useTranslation()
  return (
    <>
      <WebviewSearch webviewRef={webviewRef} isWebviewReady={isReady} targetId={targetId} />
      {recovery ? (
        <div
          role="alert"
          className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background px-6 text-center text-muted-foreground text-sm">
          {recovery.message}
          <Button onClick={recovery.onRecover}>{t('webview.navigation.reload')}</Button>
        </div>
      ) : isLoading && !isReady ? (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-muted-foreground text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          <span>{t('webview.browser.loading')}</span>
        </div>
      ) : null}
      {!recovery && errorMessage ? (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-background px-6 text-center text-muted-foreground text-sm">
          {errorMessage}
        </div>
      ) : null}
    </>
  )
}
