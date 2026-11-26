import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const ProxystacksLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="#0A0A0A" d="M0 0H120V120H0z" />
    <path
      fill="#FFF"
      fillRule="evenodd"
      d="M40 34H64C73.3888 34 81 40.7157 81 49C81 55.5812 76.7607 61.1742 70.75 63.1895L82 86H70.6L60.2 64H50V86H40V34ZM50 43V55H63.5C67.6421 55 71 52.3137 71 49C71 45.6863 67.6421 43 63.5 43H50Z"
      clipRule="evenodd"
    />
  </svg>
)
export { ProxystacksLight }
export default ProxystacksLight
