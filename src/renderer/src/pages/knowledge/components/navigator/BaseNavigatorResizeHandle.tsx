import type { BaseNavigatorResizeHandleProps } from './types'

const BaseNavigatorResizeHandle = ({ onResizeStart }: BaseNavigatorResizeHandleProps) => {
  return (
    <div
      data-testid="base-navigator-resize-handle"
      onMouseDown={onResizeStart}
      className="group/handle absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize">
      <div className="mx-auto h-full w-px bg-primary/30 opacity-0 transition-opacity group-hover/handle:opacity-100" />
    </div>
  )
}

export default BaseNavigatorResizeHandle
