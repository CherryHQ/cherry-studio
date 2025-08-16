import { makeSvgScalable } from '@renderer/utils/image'
import React, { FC, useEffect, useRef, useState } from 'react'

interface SvgProps extends React.SVGProps<SVGSVGElement> {
  'data-needs-measurement'?: 'true'
}

/**
 * A smart SVG renderer for Markdown content.
 *
 * This component handles two types of SVGs passed from `react-markdown`:
 *
 * 1.  **Pre-processed SVGs**: Simple SVGs that were already handled by the
 *     `rehypeScalableSvg` plugin. These are rendered directly with zero
 *     performance overhead.
 *
 * 2.  **SVGs needing measurement**: Complex SVGs (e.g., with unit-based
 *     dimensions like "100pt") are flagged with `data-needs-measurement`.
 *     This component will perform a one-time, off-screen measurement for
 *     these SVGs upon mounting to ensure they are rendered correctly and
 *     scalably.
 */
const MarkdownSvgRenderer: FC<SvgProps> = (props) => {
  const { 'data-needs-measurement': needsMeasurement, ...restProps } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const [isMeasured, setIsMeasured] = useState(false)

  useEffect(() => {
    if (needsMeasurement && svgRef.current && !isMeasured) {
      // The element is a real DOM node, we can now measure it.
      makeSvgScalable(svgRef.current)
      // Set flag to prevent re-measuring on subsequent renders
      setIsMeasured(true)
    }
  }, [needsMeasurement, isMeasured])

  // For SVGs that need measurement, we render them once with their original
  // props to allow the ref to capture the DOM element for measurement.
  // The `useEffect` will then trigger, process the element, and cause a
  // re-render with the correct scalable attributes.
  // For simple SVGs, they are rendered correctly from the start.
  return <svg ref={svgRef} {...restProps} />
}

export default MarkdownSvgRenderer
