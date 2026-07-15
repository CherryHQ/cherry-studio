import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { type MouseEvent as ReactMouseEvent, useCallback, useRef, useState } from 'react'

import { BaseNavigator } from '../components/navigator'
import { useKnowledgePage } from '../KnowledgePageProvider'

const NAVIGATOR_DEFAULT_WIDTH = 240
const NAVIGATOR_MIN_WIDTH = 220
const NAVIGATOR_MAX_WIDTH = 360

const KnowledgePageNavigatorSection = () => {
  const {
    bases,
    groups,
    contentRef,
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
  const contentLeftRef = useRef(0)

  const handleNavigatorResizeMove = useCallback((moveEvent: MouseEvent) => {
    const nextWidth = moveEvent.clientX - contentLeftRef.current
    setNavigatorWidth(Math.min(NAVIGATOR_MAX_WIDTH, Math.max(NAVIGATOR_MIN_WIDTH, nextWidth)))
  }, [])

  const { startResizing: startNavigatorResizeDrag } = useResizeDrag({ onMove: handleNavigatorResizeMove })

  const startNavigatorResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      contentLeftRef.current = contentRef.current?.getBoundingClientRect().left ?? 0
      startNavigatorResizeDrag(event)
    },
    [contentRef, startNavigatorResizeDrag]
  )

  return (
    <BaseNavigator
      bases={bases}
      groups={groups}
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
