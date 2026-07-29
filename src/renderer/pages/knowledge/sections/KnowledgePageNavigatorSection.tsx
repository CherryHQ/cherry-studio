import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import {
  getHorizontalResizeOrigin,
  getHorizontalResizeWidth,
  type HorizontalResizeOrigin
} from '@renderer/utils/horizontalGeometry'
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
  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  const resizeOriginRef = useRef<HorizontalResizeOrigin>({ fixedX: 0, handleEdge: 'right' })

  const handleNavigatorResizeMove = useCallback((moveEvent: MouseEvent) => {
    const nextWidth = getHorizontalResizeWidth(resizeOriginRef.current, moveEvent.clientX)
    setNavigatorWidth(Math.min(NAVIGATOR_MAX_WIDTH, Math.max(NAVIGATOR_MIN_WIDTH, nextWidth)))
  }, [])

  const { startResizing: startNavigatorResizeDrag } = useResizeDrag({ onMove: handleNavigatorResizeMove })

  const startNavigatorResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.parentElement?.getBoundingClientRect()
      resizeOriginRef.current = getHorizontalResizeOrigin(
        rect ?? { left: event.clientX - NAVIGATOR_DEFAULT_WIDTH, right: event.clientX },
        event.clientX
      )
      startNavigatorResizeDrag(event)
    },
    [startNavigatorResizeDrag]
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
