import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AiStudioMono: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 512 512" {...props}>
    <defs>
      <mask id="a">
        <path fill="#fff" d="M0 0H512V512H0z" />
        <circle cx={330} cy={175} r={110} />
      </mask>
    </defs>
    <rect
      width={256}
      height={256}
      x={120}
      y={120}
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth={28}
      mask="url(#a)"
      rx={24}
      ry={24}
    />
    <path
      fill="currentColor"
      d="M 330 68 C 330 68 318 118 302 134 C 286 150 236 162 236 162 C 236 162 286 174 302 190 C 318 206 330 256 330 256 C 330 256 342 206 358 190 C 374 174 424 162 424 162 C 424 162 374 150 358 134 C 342 118 330 68 330 68 Z"
    />
  </svg>
)
export { AiStudioMono }
export default AiStudioMono
