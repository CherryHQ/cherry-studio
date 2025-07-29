import { useMemo } from 'react'

/**
 * Compute a width string that fits the longest label text within a form.
 * This is useful when using Ant Design `Form` with `labelCol` so that the layout
 * adapts across different languages where label lengths vary.
 *
 * @param labels Array of label strings to measure. These should already be translated.
 * @param extraPadding Extra pixels added to the measured width to provide spacing.
 *                     Defaults to 50px which visually matches earlier fixed width.
 * @returns A width string that can be used in CSS, e.g. "140px".
 */
export const useDynamicLabelWidth = (labels: string[], extraPadding = 40): string => {
  return useMemo(() => {
    if (typeof window === 'undefined' || !labels || labels.length === 0) return '170px'

    // Create a hidden span for text measurement
    const span = document.createElement('span')
    span.style.visibility = 'hidden'
    span.style.position = 'absolute'
    span.style.whiteSpace = 'nowrap'
    span.style.fontSize = getComputedStyle(document.body).fontSize ?? '14px'
    document.body.appendChild(span)

    let maxWidth = 0
    labels.forEach((text) => {
      span.textContent = text
      maxWidth = Math.max(maxWidth, span.offsetWidth)
    })

    document.body.removeChild(span)

    return `${maxWidth + extraPadding}px`
  }, [extraPadding, labels])
}
