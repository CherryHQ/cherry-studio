import type { CustomContainerComponentProps } from 'virtua'

export function MessageVirtualListContainer({ style, children, ref }: CustomContainerComponentProps) {
  // #24842: virtua's scroll-time suppression blocks nested scrollers from owning input.
  let containerStyle = style
  if ('pointerEvents' in style) {
    containerStyle = { ...style }
    delete containerStyle.pointerEvents
  }
  return (
    <div ref={ref} style={containerStyle}>
      {children}
    </div>
  )
}
