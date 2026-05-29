import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NutstorePathSelector } from '../NutstorePathSelector'
import { TopView } from '../TopView'

const CLOSE_ANIMATION_MS = 200

interface Props {
  fs: Nutstore.Fs
  resolve: (data: string | null) => void
}

const PopupContainer: React.FC<Props> = ({ resolve, fs }) => {
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

  const onCancel = () => {
    setOpen(false)
    resolveAfterClose()
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
        <NutstorePathSelector fs={fs} onConfirm={resolve} onCancel={onCancel} />
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
      TopView.show(
        <PopupContainer
          fs={fs}
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
