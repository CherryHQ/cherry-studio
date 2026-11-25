// import { loggerService } from '@logger'
import { useCallback, useState } from 'react'

// const logger = loggerService.withContext('useDrag')

export const useDrag = <T extends HTMLElement>(onDrop?: (e: React.DragEvent<T>) => Promise<void> | void) => {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent<T>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<T>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<T>) => {
    e.preventDefault()
    e.stopPropagation()

    // 确保是离开当前元素，而不是进入子元素
    // logger.debug('drag leave', { currentTarget: e.currentTarget, relatedTarget: e.relatedTarget })
    const NodeType = e.currentTarget.ownerDocument.defaultView?.Node ?? Node

    if (e.relatedTarget instanceof NodeType && e.currentTarget.contains(e.relatedTarget)) {
      return
    }

    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent<T>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      await onDrop?.(e)
    },
    [onDrop]
  )

  return { isDragging, setIsDragging, handleDragOver, handleDragEnter, handleDragLeave, handleDrop }
}
