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
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<MenuPosition | null>(null)

  const closeContextMenu = useCallback(() => {
    setIsMenuOpen(false)
    setContextMenuPosition(null)
  }, [])

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setIsMenuOpen(open)

    if (!open) {
      setContextMenuPosition(null)
    }
  }, [])

  const openContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()

    setIsMenuOpen(true)
    setContextMenuPosition(getMenuPosition(event))
  }, [])

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      openContextMenu(event)
    },
    [openContextMenu]
  )

  const handleMoreButtonClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setContextMenuPosition(null)
  }, [])

  return {
    isMenuOpen,
    contextMenuPosition,
    closeContextMenu,
    handleContextMenu,
    handleMenuOpenChange,
    handleMoreButtonClick
  }
}

export default useContextMenuPosition
