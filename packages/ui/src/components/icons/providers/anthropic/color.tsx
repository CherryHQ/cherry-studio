import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Anthropic: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 24 24" {...props}>
    <g clipPath="url(#anthropic__a)">
      <path
        fill="#CA9F7B"
        d="M18 0H6C2.68629 0 0 2.68629 0 6V18C0 21.3137 2.68629 24 6 24H18C21.3137 24 24 21.3137 24 18V6C24 2.68629 21.3137 0 18 0Z"
      />
      <path
        fill="#191918"
        d="M15.3843 6.43481H12.9687L17.3739 17.5652H19.7896L15.3843 6.43481ZM8.40522 6.43481L4 17.5652H6.4633L7.36417 15.2279H11.9729L12.8737 17.5652H15.337L10.9318 6.43481H8.40522ZM8.16104 13.1607L9.66852 9.24907L11.176 13.1607H8.16104Z"
      />
    </g>
    <defs>
      <clipPath id="anthropic__a">
        <path fill="#fff" d="M0 0H24V24H0z" />
      </clipPath>
    </defs>
  </svg>
)
export { Anthropic }
export default Anthropic
