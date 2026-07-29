import { useDirection } from '@cherrystudio/ui'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { type MouseEvent as ReactMouseEvent, useCallback, useRef, useState } from 'react'

import { BaseNavigator } from '../components/navigator'
import { useKnowledgePage } from '../KnowledgePageProvider'

const NAVIGATOR_DEFAULT_WIDTH = 250
const NAVIGATOR_MIN_WIDTH = 220
const NAVIGATOR_MAX_WIDTH = 360

const KnowledgePageNavigatorSection = () => {
  const {
    bases,
    groups,
    isLoading,
    selectedBaseId,
    selectBase,
    openCreateGroupDialog,
    openCreateBaseDialog,
    moveBase,
    openRenameBaseDialog,
    openRenameGroupDialog,
    deleteGroup,
    deleteBase
  } = useKnowledgePage()
  const direction = useDirection()
  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  // The handle rides the navigator's inline-end edge, so pointer movement toward that
  // edge grows the pane — the sign flips in RTL. Tracking the drag as a delta from the
  // width we started at keeps this independent of where the navigator sits on screen.
  const dragStartRef = useRef({ clientX: 0, width: NAVIGATOR_DEFAULT_WIDTH, growSign: 1 })

  const handleNavigatorResizeMove = useCallback((moveEvent: MouseEvent) => {
    const { clientX, width, growSign } = dragStartRef.current
    const nextWidth = width + (moveEvent.clientX - clientX) * growSign
    setNavigatorWidth(Math.min(NAVIGATOR_MAX_WIDTH, Math.max(NAVIGATOR_MIN_WIDTH, nextWidth)))
  }, [])

  const { startResizing: startNavigatorResizeDrag } = useResizeDrag({ onMove: handleNavigatorResizeMove })

  const startNavigatorResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      dragStartRef.current = {
        clientX: event.clientX,
        width: navigatorWidth,
        growSign: direction === 'rtl' ? -1 : 1
      }
      startNavigatorResizeDrag(event)
    },
    [direction, navigatorWidth, startNavigatorResizeDrag]
  )

  return (
    <BaseNavigator
      bases={bases}
      groups={groups}
      isLoading={isLoading}
      width={navigatorWidth}
      selectedBaseId={selectedBaseId}
      onSelectBase={selectBase}
      onCreateGroup={openCreateGroupDialog}
      onCreateBase={openCreateBaseDialog}
      onMoveBase={moveBase}
      onRenameBase={openRenameBaseDialog}
      onRenameGroup={openRenameGroupDialog}
      onDeleteGroup={deleteGroup}
      onDeleteBase={deleteBase}
      onResizeStart={startNavigatorResize}
    />
  )
}

export default KnowledgePageNavigatorSection
