import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const SerpKiteLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <g transform="scale(3.75)">
      <rect width={32} height={32} fill="#0B0B0A" rx={6} />
      <path fill="#F6F5F2" d="M13 2h6v4h4v4h4v6h-4v4h-4v4h-6v-4H9v-4H5v-6h4V6h4Z" />
      <path fill="#F0642E" d="M17 25h3v3h-3z" />
      <path fill="#F0642E" d="M13 28.5h3v3h-3z" opacity={0.6} />
    </g>
  </svg>
)
export { SerpKiteLight }
export default SerpKiteLight
