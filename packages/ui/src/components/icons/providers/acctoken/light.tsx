import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AcctokenLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="#111" d="M0 0H120V120H0z" />
    <g transform="matrix(.25862 0 0 .25862 -6.207 -6.207)">
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
    </g>
  </svg>
)
export { AcctokenLight }
export default AcctokenLight
