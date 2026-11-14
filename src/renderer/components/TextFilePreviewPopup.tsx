import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'

const FileEditor = lazy(() => import('@renderer/components/FileEditor'))

interface OwnProps {
  text: string
  title: string
  extension?: string
}

type Props = OwnProps & PopupInjectedProps<void>

const PopupContainer: React.FC<Props> = ({ text, title, extension, open, resolve }) => {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && resolve()}>
      <DialogContent className="h-[80vh] max-h-[calc(100vh-2rem)] max-w-[700px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[20px] p-0 sm:max-w-[700px]">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-hidden">
          {extension !== undefined ? (
            <Suspense fallback={null}>
              <FileEditor className="h-full" readOnly value={text} fileName={`${title}.${extension}`} />
            </Suspense>
          ) : (
            <div className="h-full cursor-text overflow-auto p-4 text-sm whitespace-pre text-foreground">{text}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const TextFilePreviewPopupHandle = createPopup<OwnProps, void>(PopupContainer)

/**
 * Adapter preserving the popup's positional call form `show(text, title, extension?)`
 * over the createPopup handle, whose `show` takes a single props object.
 */
const TextFilePreviewPopup = {
  show: (text: string, title: string, extension?: string): Promise<void> =>
    TextFilePreviewPopupHandle.show({ text, title, extension }),
  hide: (): void => TextFilePreviewPopupHandle.hide()
}

export default TextFilePreviewPopup
import { lazy, Suspense } from 'react'
