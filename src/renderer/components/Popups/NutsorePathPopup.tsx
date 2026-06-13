import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NutstorePathSelector } from '../NutstorePathSelector'
import { TopView } from '../TopView'
import { useTopViewClose } from './useTopViewClose'

interface Props {
  fs: Nutstore.Fs
  resolve: (data: string | null) => void
}

const PopupContainer: React.FC<Props> = ({ resolve, fs }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const closePopup = useTopViewClose({ resolve, setOpen, topViewKey: TopViewKey })

  const onCancel = () => {
    closePopup(null)
  }

  const onOpenChange = (next: boolean) => {
    if (!next) {
      onCancel()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.data.nutstore.pathSelector.title')}</DialogTitle>
        </DialogHeader>
        <NutstorePathSelector fs={fs} onConfirm={closePopup} onCancel={onCancel} />
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'NutstorePathPopup'

export default class NutstorePathPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(fs: Nutstore.Fs) {
    return new Promise<any>((resolve) => {
      TopView.show(<PopupContainer fs={fs} resolve={resolve} />, TopViewKey)
    })
  }
}
