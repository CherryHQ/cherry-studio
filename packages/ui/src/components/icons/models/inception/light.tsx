import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const InceptionLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <path
      fill="#000"
      fillRule="evenodd"
      d="M14.0124 4H9.00655L4 9.00582V14.0124H9.00655V9.00582H14.0124V4ZM9.98836 20H14.9935L20 14.9935V9.98764H14.9935V14.9935H9.98836V20Z"
      clipRule="evenodd"
      transform="translate(-2.48 -2.48)scale(5.20661)"
    />
  </svg>
)
export { InceptionLight }
export default InceptionLight
