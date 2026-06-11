import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { GlobalSearchPanel } from '@renderer/components/GlobalSearch/GlobalSearchPanel'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'
import { useTopViewClose } from './useTopViewClose'

interface Props {
  resolve: () => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const closeTopView = useTopViewClose({ resolve, setOpen, topViewKey: 'SearchPopup' })
  const closePopup = () => closeTopView()

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
        closeOnOverlayClick
        onOpenAutoFocus={(event) => event.preventDefault()}
        overlayClassName="bg-black/50 backdrop-blur-[8px]"
        className="flex h-[80vh] max-h-[80vh] w-[60vw] max-w-[60vw] flex-col gap-0 overflow-hidden rounded-[32px] border border-border-subtle bg-background p-0 shadow-2xl sm:max-w-[60vw]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('globalSearch.open')}</DialogTitle>
        </DialogHeader>
        <GlobalSearchPanel onClose={closePopup} />
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
    return new Promise<void>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, 'SearchPopup')
    })
  }
}
