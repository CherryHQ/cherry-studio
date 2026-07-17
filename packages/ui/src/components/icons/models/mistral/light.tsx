import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const MistralLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
    <path fill="gold" d="M1.71399 2H3.42849V3.714H1.71399V2ZM8.57099 2H10.286V3.714H8.57099V2Z" />
    <path
      fill="#FFAF00"
      d="M1.71399 3.714H5.14249V5.4285H1.71449L1.71399 3.714ZM6.85699 3.714H10.2855V5.4285H6.85699V3.714Z"
    />
    <path fill="#FF8205" d="M1.71399 5.429H10.286V7.143H1.71399V5.429Z" />
    <path
      fill="#FA500F"
      d="M1.71399 7.14301H3.42849V8.85701H1.71399V7.14301ZM5.14299 7.14301H6.85749V8.85701H5.14299V7.14301ZM8.57099 7.14301H10.286V8.85701H8.57099V7.14301Z"
    />
    <path fill="#E10500" d="M0 8.85701H5.143V10.5715H0V8.85701ZM6.857 8.85701H12V10.5715H6.857V8.85701Z" />
  </svg>
)
export { MistralLight }
export default MistralLight
