import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UserAccountPanel } from './UserAccountPanel'

type Props = PopupInjectedProps<Record<string, never>>

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()
  const [isEditingUserName, setIsEditingUserName] = useState(false)

  const close = () => {
    setIsEditingUserName(false)
    resolve({})
  }

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) close()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-56 gap-0 rounded-md p-0 sm:max-w-56"
        onEscapeKeyDown={(event) => {
          if (isEditingUserName) event.preventDefault()
        }}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t('settings.general.user_name.label')}</DialogTitle>
        </DialogHeader>
        <UserAccountPanel active={open} onEditingUserNameChange={setIsEditingUserName} onRequestClose={close} />
      </DialogContent>
    </Dialog>
  )
}

const UserPopup = createPopup<Record<string, never>, Record<string, never>>(PopupContainer, { dismissResult: {} })

export default UserPopup
