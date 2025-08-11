import { TopView } from '@renderer/components/TopView'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingGroup } from '..'
import CustomLanguageSettings from './CustomLanguageSettings'
import TranslatePromptSettings from './TranslatePromptSettings'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { theme } = useTheme()
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

  TranslateSettingsPopup.hide = onCancel

  return (
    <Modal
      title={t('settings.translate.title')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      width="80vw"
      centered>
      <SettingContainer theme={theme} style={{ padding: '10px 0' }}>
        <TranslatePromptSettings />
        <SettingGroup theme={theme} style={{ flex: 1 }}>
          <CustomLanguageSettings />
        </SettingGroup>
      </SettingContainer>
    </Modal>
  )
}

const TopViewKey = 'TranslateSettingsPopup'

export default class TranslateSettingsPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
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
