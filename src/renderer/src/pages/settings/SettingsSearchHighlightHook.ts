import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { useSettingsSearch } from './SettingsSearchContext'

/**
 * Hook to highlight all matching setting elements based on search query
 * Reads matching texts from context for the current route and highlights them
 */
export const useHighlightSettings = () => {
  const { pathname } = useLocation()
  const { matchingTexts, isSearchActive, searchQuery } = useSettingsSearch()
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const attemptTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const highlightedElements = useRef<HTMLElement[]>([])

  useEffect(() => {
    // Clear previous highlights
    const clearHighlights = () => {
      highlightedElements.current.forEach((el) => {
        el.classList.remove('setting-highlight')
        el.style.backgroundColor = ''
        el.style.transition = ''
        el.style.borderRadius = ''
      })
      highlightedElements.current = []
    }

    clearHighlights()

    // Clear any pending attempt timeouts
    attemptTimeoutsRef.current.forEach(clearTimeout)
    attemptTimeoutsRef.current = []

    if (!isSearchActive) return

    // Get matching texts for current route
    const textsToHighlight = matchingTexts.get(pathname) || []

    if (textsToHighlight.length === 0) return

    // Normalize text for comparison
    const normalizeText = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

    const attemptHighlight = () => {
      const container = document.getElementById('content-container') || document.body

      // Find all text nodes and highlight matches
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)

      let node: Node | null = null
      const foundElements: HTMLElement[] = []

      while ((node = walker.nextNode())) {
        const nodeText = node.textContent || ''
        const normalizedNodeText = normalizeText(nodeText)

        // Check if this node matches any of the texts to highlight
        for (const targetText of textsToHighlight) {
          const normalizedTarget = normalizeText(targetText)

          if (
            normalizedNodeText === normalizedTarget ||
            (normalizedTarget.includes(normalizedNodeText) && normalizedNodeText.length > 2)
          ) {
            if (node.parentElement && !foundElements.includes(node.parentElement)) {
              // Find the nearest row element for better highlighting
              const element = node.parentElement
              const rowElement =
                element.closest('.ant-table-row') ||
                element.closest('[class*="SettingRow"]') ||
                element.closest('[class*="setting-row"]') ||
                element.closest('tr') ||
                element

              const highlightTarget = (rowElement as HTMLElement) || element

              if (!foundElements.includes(highlightTarget)) {
                foundElements.push(highlightTarget)
              }
            }
            break
          }
        }
      }

      // Apply highlights
      foundElements.forEach((el) => {
        el.style.transition = 'background-color 0.5s'
        el.style.backgroundColor = 'rgba(255, 200, 0, 0.3)'
        el.style.borderRadius = '4px'
        el.classList.add('setting-highlight')
      })

      // Scroll to the first highlighted element
      if (foundElements.length > 0) {
        foundElements[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
      }

      highlightedElements.current = foundElements

      // Remove highlights after some time
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
      highlightTimeoutRef.current = setTimeout(() => {
        foundElements.forEach((el) => {
          el.style.backgroundColor = ''
        })
      }, 3000)

      return foundElements.length > 0
    }

    // Attempt with increasing delays to handle dynamic content
    const delays = [0, 100, 300, 500, 800]
    delays.forEach((delay) => {
      const timeoutId = setTimeout(() => {
        attemptHighlight()
      }, delay)
      attemptTimeoutsRef.current.push(timeoutId)
    })

    return () => {
      highlightedElements.current.forEach((el) => {
        el.classList.remove('setting-highlight')
        el.style.backgroundColor = ''
        el.style.transition = ''
        el.style.borderRadius = ''
      })
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)

      // Clear pending attempt timeouts to prevent stale closures from re-applying highlights
      attemptTimeoutsRef.current.forEach(clearTimeout)
      attemptTimeoutsRef.current = []
    }
  }, [pathname, matchingTexts, isSearchActive, searchQuery])
}
