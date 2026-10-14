import type { SVGProps } from 'react'

import type { IconComponent } from '../types'
const VtcodeCli: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" {...props}>
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M0.5 5.5L2.5 8 0.5 10.5"
    />
    <text
      x={3.2}
      y={11.5}
      fill="currentColor"
      fontFamily="'SF Mono', 'Fira Code', 'Consolas', monospace"
      fontSize={10}
      fontWeight={600}
      letterSpacing={-0.5}
    >
      {'VT'}
    </text>
  </svg>
)
export { VtcodeCli }
export default VtcodeCli
