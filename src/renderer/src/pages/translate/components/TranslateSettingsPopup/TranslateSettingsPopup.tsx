import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { useTheme } from '@renderer/context/ThemeProvider'
import { SettingContainer, SettingGroup } from '@renderer/pages/settings'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import TranslateLanguageSettings from './TranslateLanguageSettings'
import TranslatePromptSettings from './TranslatePromptSettings'

interface Props {
  resolve: (data: any) => void
}

export const TranslateSettingsPanelContent = () => {
  const { theme } = useTheme()

  return (
    <SettingContainer theme={theme} style={{ padding: 0, background: 'transparent' }}>
      <TranslatePromptSettings />
      <SettingGroup theme={theme} style={{ flex: 1 }}>
        <TranslateLanguageSettings />
      </SettingGroup>
    </SettingContainer>
  )
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  const closePopup = () => {
    setOpen(false)
    resolve({})
  }

  TranslateSettingsPopup.hide = closePopup

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closePopup()}>
      <DialogContent className="max-h-[90vh] max-w-[80vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('settings.translate.title')}</DialogTitle>
        </DialogHeader>
        <TranslateSettingsPanelContent />
      </DialogContent>
    </Dialog>
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
