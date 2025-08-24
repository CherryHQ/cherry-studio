import { useCallback, useState } from 'react'

export const useDrag = <T extends HTMLElement>(onDrop: (e: React.DragEvent<T>) => Promise<void> | void) => {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent<T>) => {
    e.preventDefault()
    e.stopPropagation()
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
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return
    }
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent<T>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      await onDrop(e)
    },
    [onDrop]
  )

  return { isDragging, handleDragOver, handleDragEnter, handleDragLeave, handleDrop }
}
