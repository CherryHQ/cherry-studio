import { TopView } from '@renderer/components/TopView'
import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { Button, Modal } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const WebViewContainer = styled.div`
  width: 100%;
  height: min(500px, calc(85vh - 132px));
  overflow: hidden;

  webview {
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
  }
`

interface ShowParams {
  title?: string
  acceptButtonText?: string
  showDeclineButton?: boolean
  force?: boolean
  quitOnDecline?: boolean
  modal?: boolean
  onAccepted?: () => void
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({
  title,
  acceptButtonText,
  showDeclineButton,
  quitOnDecline,
  modal = false,
  onAccepted,
  resolve
}) => {
  const [open, setOpen] = useState(true)
  const [privacyUrl, setPrivacyUrl] = useState<string>('')
  const resolvedRef = useRef(false)
  const { theme } = useTheme()
  const { i18n, t } = useTranslation()
  const shouldShowDeclineButton = !modal && (showDeclineButton ?? true)
  const shouldQuitOnDecline = quitOnDecline ?? !modal

  const getTitle = () => {
    if (title) return title
    return t('privacy_policy.title')
  }

  const resolveOnce = useCallback(
    (data: { accepted: boolean }) => {
      if (resolvedRef.current) {
        return
      }

      resolvedRef.current = true
      resolve(data)
    },
    [resolve]
  )

  const handleAccept = () => {
    setOpen(false)
    localStorage.setItem('privacy-popup-accepted', 'true')
    onAccepted?.()
    resolveOnce({ accepted: true })
  }

  const handleDecline = () => {
    setOpen(false)
    if (shouldQuitOnDecline) {
      void window.api.quit()
    }
    resolveOnce({ accepted: false })
  }

  useEffect(() => {
    void runAsyncFunction(async () => {
      const { appPath } = await window.api.getAppInfo()
      const isChinese = i18n.language.startsWith('zh')
      const htmlFile = isChinese ? 'privacy-zh.html' : 'privacy-en.html'
      const url = `file://${appPath}/resources/cherry-studio/${htmlFile}?theme=${theme === ThemeMode.dark ? 'dark' : 'light'}`
      setPrivacyUrl(url)
    })
  }, [theme, i18n.language])

  PrivacyPopup.hide = () => setOpen(false)

  return (
    <Modal
      title={getTitle()}
      open={open}
      onCancel={shouldShowDeclineButton ? handleDecline : undefined}
      transitionName=""
      maskTransitionName=""
      centered
      closable={false}
      maskClosable={false}
      styles={{
        content: { maxHeight: '85vh', overflow: 'hidden' },
        header: { paddingLeft: 20 },
        body: { paddingLeft: 20, overflow: 'hidden' }
      }}
      width={900}
      footer={[
        shouldShowDeclineButton && (
          <Button key="decline" onClick={handleDecline}>
            {t('common.decline')}
          </Button>
        ),
        <Button key="accept" type="primary" onClick={handleAccept}>
          {acceptButtonText ?? t('common.i_know')}
        </Button>
      ].filter(Boolean)}>
      <WebViewContainer>
        {privacyUrl && <webview src={privacyUrl} style={{ width: '100%', height: '100%' }} />}
      </WebViewContainer>
    </Modal>
  )
}

const TopViewKey = 'PrivacyPopup'

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
      TopView.show(
        <PopupContainer
          {...(props || {})}
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
