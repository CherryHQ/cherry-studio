import { useEffect, useRef } from 'react'

/**
 * Hook to highlight a setting element based on URL search parameter
 * @param search - The URL search string (e.g., "?highlight=拼写检查")
 */
export const useHighlightSetting = (search: string) => {
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const foundRef = useRef<boolean>(false)

  useEffect(() => {
    const params = new URLSearchParams(search)
    const highlightText = params.get('highlight')

    if (!highlightText) return

    foundRef.current = false

    // Clear previous highlights
    document.querySelectorAll('.setting-highlight').forEach((el) => {
      el.classList.remove('setting-highlight')
      ;(el as HTMLElement).style.backgroundColor = ''
      ;(el as HTMLElement).style.transition = ''
      ;(el as HTMLElement).style.borderRadius = ''
    })

    // Normalize text for comparison
    const normalizeText = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')
    const targetText = normalizeText(highlightText)

    const attemptHighlight = () => {
      if (foundRef.current) return true

      const container = document.getElementById('content-container') || document.body

      // Find element containing the text
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)

      let node: Node | null = null
      let targetNode: Node | null = null
      let bestMatch: { node: Node; similarity: number } | null = null

      while ((node = walker.nextNode())) {
        const nodeText = node.textContent || ''
        const normalizedNodeText = normalizeText(nodeText)

        // Exact match
        if (normalizedNodeText === targetText) {
          targetNode = node
          break
        }

        // Partial match - node contains the target text
        if (normalizedNodeText.includes(targetText) || targetText.includes(normalizedNodeText)) {
          const similarity =
            Math.min(normalizedNodeText.length, targetText.length) /
            Math.max(normalizedNodeText.length, targetText.length)
          if (!bestMatch || similarity > bestMatch.similarity) {
            bestMatch = { node, similarity }
          }
        }
      }

      // Use best match if no exact match found
      if (!targetNode && bestMatch && bestMatch.similarity > 0.5) {
        targetNode = bestMatch.node
      }

      if (targetNode && targetNode.parentElement) {
        foundRef.current = true

        // Find the nearest row element for better highlighting
        const element = targetNode.parentElement
        const rowElement =
          element.closest('.ant-table-row') ||
          element.closest('[class*="SettingRow"]') ||
          element.closest('[class*="setting-row"]') ||
          element.closest('tr') ||
          element

        const highlightTarget = (rowElement as HTMLElement) || element

        // Scroll into view
        highlightTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })

        // Apply highlight
        highlightTarget.style.transition = 'background-color 0.5s'
        highlightTarget.style.backgroundColor = 'rgba(255, 200, 0, 0.3)'
        highlightTarget.style.borderRadius = '4px'
        highlightTarget.classList.add('setting-highlight')

        // Remove highlight after a few seconds
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
        highlightTimeoutRef.current = setTimeout(() => {
          highlightTarget.style.backgroundColor = ''
        }, 1000)

        return true
      }

      return false
    }

    // Attempt with increasing delays
    const delays = [0, 100, 300, 500, 800, 1200, 2000]
    delays.forEach((delay) => {
      setTimeout(() => {
        if (!foundRef.current) {
          attemptHighlight()
        }
      }, delay)
    })

    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
    }
  }, [search])
}
