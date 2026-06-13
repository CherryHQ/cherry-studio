import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import HistoryPage from '@renderer/pages/history/HistoryPage'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'
import { useTopViewClose } from './useTopViewClose'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const closeTopView = useTopViewClose({ resolve, setOpen, topViewKey: 'SearchPopup' })
  const closePopup = () => closeTopView({})

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
        className="h-[80vh] max-h-[80vh] max-w-[700px] overflow-hidden rounded-[20px] p-0 pb-4">
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
      TopView.show(<PopupContainer resolve={resolve} />, 'SearchPopup')
    })
  }
}
