import { CodeEditor, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useRef, useState } from 'react'

import { TopView } from '../TopView'

const CLOSE_ANIMATION_MS = 200

interface Props {
  text: string
  title: string
  extension?: string
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ text, title, extension, resolve }) => {
  const [open, setOpen] = useState(true)
  const resolvedRef = useRef(false)
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()

  const closePopup = () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    setOpen(false)
    window.setTimeout(() => resolve({}), CLOSE_ANIMATION_MS)
  }

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closePopup()
    }
  }

  TextFilePreviewPopup.hide = closePopup

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[80vh] max-h-[calc(100vh-2rem)] max-w-[700px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[20px] p-0 sm:max-w-[700px]">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-hidden">
          {extension !== undefined ? (
            <CodeEditor
              className="[&_.cm-line]:cursor-text"
              theme={activeCmTheme}
              fontSize={fontSize - 1}
              readOnly={true}
              expanded={false}
              height="100%"
              style={{ height: '100%' }}
              value={text}
              language={extension}
              options={{
                keymap: true
              }}
            />
          ) : (
            <div className="h-full cursor-text overflow-auto whitespace-pre p-4 text-foreground text-sm">{text}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default class TextFilePreviewPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('TextFilePreviewPopup')
  }
  static show(text: string, title: string, extension?: string) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          text={text}
          title={title}
          extension={extension}
          resolve={(v) => {
            resolve(v)
            TopView.hide('TextFilePreviewPopup')
          }}
        />,
        'TextFilePreviewPopup'
      )
    })
  }
}
