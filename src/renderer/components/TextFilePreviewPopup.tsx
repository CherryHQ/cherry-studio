import { CodeEditor, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'

interface OwnProps {
  text: string
  title: string
  extension?: string
}

type Props = OwnProps & PopupInjectedProps<void>

const PopupContainer: React.FC<Props> = ({ text, title, extension, open, resolve }) => {
  const [fontSize] = usePreference('chat.message.font_size')
  const { activeCmTheme } = useCodeStyle()

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && resolve()}>
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
