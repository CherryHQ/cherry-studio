import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import HistoryPage from '@renderer/pages/history/HistoryPage'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const CLOSE_ANIMATION_MS = 200

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const resolvedRef = useRef(false)
  const { t } = useTranslation()

  const resolveAfterClose = () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    window.setTimeout(() => {
      resolve({})
    }, CLOSE_ANIMATION_MS)
  }

  const closePopup = () => {
    setOpen(false)
    resolveAfterClose()
  }

  const onOpenChange = (next: boolean) => {
    if (!next) {
      closePopup()
    }
  }

  SearchPopup.hide = closePopup

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[80vh] max-h-[80vh] max-w-[700px] flex-col overflow-hidden rounded-[20px] p-0 pb-4">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('common.search')}</DialogTitle>
        </DialogHeader>
        <HistoryPage />
      </DialogContent>
    </Dialog>
  )
}

export default class SearchPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('SearchPopup')
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide('SearchPopup')
          }}
        />,
        'SearchPopup'
      )
    })
  }
}
