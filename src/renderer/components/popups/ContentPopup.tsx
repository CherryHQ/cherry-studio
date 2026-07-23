import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type { CSSProperties, ReactNode } from 'react'

interface ContentPopupStyles {
  body?: CSSProperties
  content?: CSSProperties
  header?: CSSProperties
}

export interface ContentPopupParams {
  /** Arbitrary content rendered inside the modal body. */
  content: ReactNode
  title?: ReactNode
  width?: number | string
  /** Per-slot inline styles (header / body / the content wrapper). */
  styles?: ContentPopupStyles
  /** Close when the overlay is clicked (default true). */
  maskClosable?: boolean
  /** Show the top-right close (✕) button (default true). */
  closable?: boolean
}

type Props = ContentPopupParams & PopupInjectedProps<void>

// Custom widths (width/minWidth/maxWidth) replace DialogContent's own
// max-w-[calc(100%-2rem)] responsive cap as inline styles, so clamp every
// caller-provided length to the viewport here — a fixed 600px minWidth must
// not overflow a 520px window.
const VIEWPORT_WIDTH_CAP = 'calc(100vw - 2rem)'
function clampWidthToViewport(value: CSSProperties['width']): CSSProperties['width'] {
  if (typeof value === 'number') return `min(${value}px, ${VIEWPORT_WIDTH_CAP})`
  if (typeof value === 'string') return `min(${value}, ${VIEWPORT_WIDTH_CAP})`
  return value
}

const PopupContainer = ({
  content,
  title,
  width,
  styles,
  maskClosable = true,
  closable = true,
  open,
  resolve
}: Props) => {
  const contentStyle: CSSProperties = { ...styles?.content }
  if (width !== undefined) {
    contentStyle.width = width
  }
  for (const key of ['width', 'minWidth', 'maxWidth'] as const) {
    if (contentStyle[key] !== undefined) {
      contentStyle[key] = clampWidthToViewport(contentStyle[key])
    }
  }
  const useCustomWidth = width !== undefined || styles?.content?.maxWidth !== undefined

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resolve()}>
      <DialogContent
        showCloseButton={closable}
        closeOnOverlayClick={maskClosable}
        className={cn(useCustomWidth && 'sm:max-w-none')}
        style={Object.keys(contentStyle).length > 0 ? contentStyle : undefined}
        onPointerDownOutside={(event) => {
          if (!maskClosable) {
            event.preventDefault()
          }
        }}>
        <DialogHeader className={title ? undefined : 'sr-only'} style={styles?.header}>
          <DialogTitle>{title ?? 'Dialog'}</DialogTitle>
        </DialogHeader>
        <div style={styles?.body}>{content}</div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * ContentPopup — imperatively show arbitrary content inside a modal shell. It makes no
 * assumptions about the content and returns no value: use it to pop a panel/view (a settings
 * panel, an error detail, …) from an event handler without wiring `<Dialog open>` state
 * yourself. It has no action buttons — close via the ✕, the overlay, or Escape.
 *
 * For a yes/no answer use `popup.confirm`; to confirm-then-run a fallible action use
 * `ConfirmActionPopup`; for any dialog whose own buttons must drive a typed result, write a
 * dedicated `createPopup<P, R>` component instead.
 */
const ContentPopup = createPopup<ContentPopupParams, void>(PopupContainer)

export default ContentPopup
