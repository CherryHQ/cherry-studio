import { type MouseEvent as ReactMouseEvent, useCallback, useRef, useState } from 'react'

import { useResizeDrag } from '@renderer/hooks/useResizeDrag'

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
    contentRef,
    selectedBaseId,
    selectBase,
    openCreateGroupDialog,
    openCreateBaseDialog,
    moveBase,
    moveBases,
    openRenameBaseDialog,
    openRenameGroupDialog,
    deleteGroup,
    deleteBase,
    deleteBases
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
      isLoading={isLoading}
      width={navigatorWidth}
      selectedBaseId={selectedBaseId}
      onSelectBase={selectBase}
      onCreateGroup={openCreateGroupDialog}
      onCreateBase={openCreateBaseDialog}
      onMoveBase={moveBase}
      onMoveBases={moveBases}
      onRenameBase={openRenameBaseDialog}
      onRenameGroup={openRenameGroupDialog}
      onDeleteGroup={deleteGroup}
      onDeleteBase={deleteBase}
      onDeleteBases={deleteBases}
      onResizeStart={startNavigatorResize}
    />
  )
}

export default KnowledgePageNavigatorSection
