import { Button } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { useTheme } from '@renderer/context/ThemeProvider'
import { runAsyncFunction } from '@renderer/utils'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { Modal } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const WebViewContainer = styled.div`
  width: 100%;
  height: 500px;
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
  showDeclineButton?: boolean
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ title, showDeclineButton = true, resolve }) => {
  const [open, setOpen] = useState(true)
  const [privacyUrl, setPrivacyUrl] = useState<string>('')
  const { theme } = useTheme()
  const { i18n } = useTranslation()

  const getTitle = () => {
    if (title) return title
    const isChinese = i18n.language.startsWith('zh')
    return isChinese ? '隐私协议' : 'Privacy Policy'
  }

  const handleAccept = () => {
    setOpen(false)
    localStorage.setItem('privacy-popup-accepted', 'true')
    resolve({ accepted: true })
  }

  const handleDecline = () => {
    setOpen(false)
    window.api.quit()
    resolve({ accepted: false })
  }

  const onClose = () => {
    if (!showDeclineButton) {
      handleAccept()
    } else {
      handleDecline()
    }
  }

  useEffect(() => {
    runAsyncFunction(async () => {
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
      onCancel={showDeclineButton ? handleDecline : undefined}
      afterClose={onClose}
      transitionName=""
      maskTransitionName=""
      centered
      closable={false}
      maskClosable={false}
      styles={{
        mask: { backgroundColor: 'var(--color-background)' },
        header: { paddingLeft: 20 },
        body: { paddingLeft: 20 }
      }}
      width={900}
      footer={[
        showDeclineButton && (
          <Button key="decline" onPress={handleDecline}>
            {i18n.language.startsWith('zh') ? '拒绝' : 'Decline'}
          </Button>
        ),
        <Button key="accept" variant="solid" color="primary" onPress={handleAccept}>
          {i18n.language.startsWith('zh') ? '同意并继续' : 'Accept and Continue'}
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

    if (accepted) {
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
