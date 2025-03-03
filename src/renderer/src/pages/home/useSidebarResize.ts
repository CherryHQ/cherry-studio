import { useState } from 'react'

export const useSidebarResize = () => {
  const [sizes, setSizes] = useState<number[]>([])

  const handleSidebarResize = (size: number[]) => {
    setSizes(size)
  }

  return {
    sizes,
    handleSidebarResize
  }
}
