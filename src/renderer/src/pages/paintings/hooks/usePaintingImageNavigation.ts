import { useCallback, useState } from 'react'

export function usePaintingImageNavigation(itemCount: number) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const resetImageIndex = useCallback(() => {
    setCurrentImageIndex(0)
  }, [])

  const nextImage = useCallback(() => {
    setCurrentImageIndex((currentIndex) => {
      if (itemCount <= 0) {
        return 0
      }

      return (currentIndex + 1) % itemCount
    })
  }, [itemCount])

  const prevImage = useCallback(() => {
    setCurrentImageIndex((currentIndex) => {
      if (itemCount <= 0) {
        return 0
      }

      return (currentIndex - 1 + itemCount) % itemCount
    })
  }, [itemCount])

  return {
    currentImageIndex,
    nextImage,
    prevImage,
    resetImageIndex
  }
}
