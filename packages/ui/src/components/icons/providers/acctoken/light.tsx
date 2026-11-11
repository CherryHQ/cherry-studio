import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AcctokenLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1em" height="1em" {...props}>
    <rect width={464} height={464} x={24} y={24} fill="#111" rx={116} />
    <path
      fill="none"
      stroke="#fff"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={42}
      d="M120 176 198 256 120 336M214 176 292 256 214 336"
    />
    <circle cx={368} cy={256} r={46} fill="#fff" />
    <circle cx={368} cy={256} r={20} fill="#111" />
  </svg>
)
export { AcctokenLight }
export default AcctokenLight
