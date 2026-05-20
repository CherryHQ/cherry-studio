import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { GlobalSearchPanel } from '@renderer/components/global-search/GlobalSearchPanel'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

const CLOSE_ANIMATION_MS = 200

interface Props {
  options?: SearchPopupOptions
  resolve: (data: any) => void
}

type SearchPopupOptions = {
  hideQuickApps?: boolean
}

const PopupContainer: React.FC<Props> = ({ options, resolve }) => {
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
        overlayClassName="bg-black/50 backdrop-blur-[8px]"
        className="flex h-[80vh] max-h-[80vh] w-[60vw] max-w-[60vw] flex-col gap-0 overflow-hidden rounded-[32px] border border-border-subtle bg-background p-0 shadow-2xl sm:max-w-[60vw]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('globalSearch.open')}</DialogTitle>
        </DialogHeader>
        <GlobalSearchPanel hideQuickApps={options?.hideQuickApps} onClose={closePopup} />
      </DialogContent>
    </Dialog>
  )
}

export default class SearchPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('SearchPopup')
  }
  static show(options?: SearchPopupOptions) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          options={options}
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
