import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { useTheme } from '@renderer/context/ThemeProvider'
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
        <SettingContainer theme={theme} style={{ padding: '10px 0', background: 'transparent' }}>
          <TranslatePromptSettings />
          <SettingGroup theme={theme} style={{ flex: 1 }}>
            <CustomLanguageSettings />
          </SettingGroup>
        </SettingContainer>
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
