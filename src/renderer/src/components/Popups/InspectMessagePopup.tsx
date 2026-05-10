import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { TopView } from '@renderer/components/TopView'
import type { Message } from '@renderer/types'
import type { MessageBlock } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CodeEditor from '../CodeEditor'

const CLOSE_ANIMATION_MS = 200

interface ShowParams {
  title: string
  message: Message
  blocks?: MessageBlock[]
  parts?: CherryMessagePart[]
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const InspectMessagePopupContainer: React.FC<Props> = ({ title, message, blocks, parts, resolve }) => {
  const [enableDeveloperMode] = usePreference('app.developer_mode.enabled')
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

  InspectMessagePopup.hide = closePopup

  if (!enableDeveloperMode) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[80vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="mb-2 font-bold text-xl">Message</div>
        <CodeEditor language="json" value={JSON.stringify(message, null, 2)} editable={false} />
        {parts !== undefined ? (
          <>
            <div className="mb-2 font-bold text-xl">Parts ({parts.length})</div>
            <CodeEditor language="json" value={JSON.stringify(parts, null, 2)} editable={false} />
          </>
        ) : (
          <>
            <div className="mb-2 font-bold text-xl">Blocks ({(blocks ?? []).length})</div>
            <CodeEditor language="json" value={JSON.stringify(blocks ?? [], null, 2)} editable={false} />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closePopup}>
            {t('common.cancel')}
          </Button>
          <Button onClick={closePopup}>{t('common.confirm')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'InspectMessagePopup'

export default class InspectMessagePopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <InspectMessagePopupContainer
          {...props}
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
