import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'

const ZaiLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <path
      fill="#000"
      fillRule="evenodd"
      d="M12.07 5L10.618 6.91945H4.43533L5.88667 5H12.0707H12.07ZM19.5027 16.0812L18.052 18H11.8907L13.34 16.0812H19.5027ZM20 5L10.176 18H4L13.824 5H20Z"
      clipRule="evenodd"
      transform="translate(-2.48 .124)scale(5.20661)"
    />
  </svg>
)

export { ZaiLight }

export default ZaiLight
