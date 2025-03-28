import { handleInAppLink } from '@renderer/utils/linkHandler'
import { RefObject, useEffect } from 'react'

export const useInAppLinks = (contentRef: RefObject<HTMLElement>, dependencies: any[] = []) => {
  useEffect(() => {
    if (!contentRef.current) return

    const clickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const closestAnchor = target.closest('a')

      if (
        closestAnchor &&
        closestAnchor.href &&
        (closestAnchor.href.startsWith('https://') || closestAnchor.href.startsWith('https://'))
      ) {
        handleInAppLink(event as any, closestAnchor.href)
      }
    }

    contentRef.current.addEventListener('click', clickHandler)

    return () => {
      contentRef.current?.removeEventListener('click', clickHandler)
    }
  }, [contentRef, ...dependencies])
}
