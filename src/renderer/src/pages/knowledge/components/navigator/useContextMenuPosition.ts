import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useState } from 'react'

import type { MenuPosition } from './types'

const getMenuPosition = (event: ReactMouseEvent<HTMLElement>): MenuPosition => {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return {
      x: event.clientX,
      y: event.clientY
    }
  }

  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: rect.right,
    y: rect.bottom
  }
}

const useContextMenuPosition = () => {
  const [contextMenuPosition, setContextMenuPosition] = useState<MenuPosition | null>(null)

  const closeContextMenu = useCallback(() => {
    setContextMenuPosition(null)
  }, [])

  const openContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()

    setContextMenuPosition(getMenuPosition(event))
  }, [])

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      openContextMenu(event)
    },
    [openContextMenu]
  )

  const handleMoreButtonClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      openContextMenu(event)
    },
    [openContextMenu]
  )

  return {
    contextMenuPosition,
    closeContextMenu,
    handleContextMenu,
    handleMoreButtonClick
  }
}

export default useContextMenuPosition
