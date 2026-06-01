import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { useTopViewClose } from '@renderer/components/Popups/useTopViewClose'
import { TopView } from '@renderer/components/TopView'
import { useTheme } from '@renderer/context/ThemeProvider'
import { runAsyncFunction } from '@renderer/utils'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  acceptButtonText?: string
  force?: boolean
  modal?: boolean
  onAccepted?: () => void
  quitOnDecline?: boolean
  showDeclineButton?: boolean
  title?: string
}

interface Props extends ShowParams {
  resolve: (data: { accepted: boolean }) => void
}

const TopViewKey = 'PrivacyPopup'

const PopupContainer: React.FC<Props> = ({
  acceptButtonText,
  modal = false,
  onAccepted,
  quitOnDecline,
  resolve,
  showDeclineButton,
  title
}) => {
  const [open, setOpen] = useState(true)
  const [privacyUrl, setPrivacyUrl] = useState('')
  const { theme } = useTheme()
  const { i18n, t } = useTranslation()
  const close = useTopViewClose({ resolve, setOpen, topViewKey: TopViewKey })
  const shouldShowDeclineButton = !modal && (showDeclineButton ?? true)
  const shouldQuitOnDecline = quitOnDecline ?? !modal

  const handleAccept = useCallback(() => {
    localStorage.setItem('privacy-popup-accepted', 'true')
    onAccepted?.()
    close({ accepted: true })
  }, [close, onAccepted])

  const handleDecline = useCallback(() => {
    if (shouldQuitOnDecline) {
      void window.api.application.quit()
    }
    close({ accepted: false })
  }, [close, shouldQuitOnDecline])

  useEffect(() => {
    void runAsyncFunction(async () => {
      const { resourcesPath } = await window.api.getAppInfo()
      const htmlFile = i18n.language.startsWith('zh') ? 'privacy-zh.html' : 'privacy-en.html'
      setPrivacyUrl(
        `file://${resourcesPath}/cherry-studio/${htmlFile}?theme=${theme === ThemeMode.dark ? 'dark' : 'light'}`
      )
    })
  }, [i18n.language, theme])

  PrivacyPopup.hide = () => close({ accepted: false })

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleDecline()}>
      <DialogContent
        className="h-[85vh] max-h-[85vh] max-w-[900px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-6 sm:max-w-[900px]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title ?? t('privacy_policy.title')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-hidden rounded-md bg-background">
          {privacyUrl && <webview src={privacyUrl} className="h-full w-full border-0 bg-transparent" />}
        </div>
        <DialogFooter>
          {shouldShowDeclineButton && (
            <Button variant="outline" onClick={handleDecline}>
              {t('common.decline')}
            </Button>
          )}
          <Button onClick={handleAccept}>{acceptButtonText ?? t('common.i_know')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default class PrivacyPopup {
  static topviewId = 0

  static hide() {
    TopView.hide(TopViewKey)
  }

  static async show(props?: ShowParams) {
    const accepted = localStorage.getItem('privacy-popup-accepted')

    if (accepted && !props?.force) {
      return
    }

    return new Promise<{ accepted: boolean }>((resolve) => {
      TopView.show(<PopupContainer {...(props || {})} resolve={resolve} />, TopViewKey)
    })
  }
}
