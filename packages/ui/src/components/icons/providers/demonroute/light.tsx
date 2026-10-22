import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const DemonrouteLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    aria-label="DemonRoute"
    shapeRendering="crispEdges"
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    {...props}
  >
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M3,1 h2 v4 h-2 z M11,1 h2 v4 h-2 z M4,4 h8 v8 h-8 z M2,6 h2 v4 h-2 z M12,6 h2 v4 h-2 z M7,12 h2 v3 h-2 z M5,6 h2 v2 h-2 z M9,6 h2 v2 h-2 z M6,9 h4 v1 h-4 z"
    />
  </svg>
)
export { DemonrouteLight }
export default DemonrouteLight
