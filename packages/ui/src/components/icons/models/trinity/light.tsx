import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const TrinityLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <path fill="var(--icon-neutral-background, #FFFFFF)" d="M0 0H120V120H0z" />
    <path
      stroke="#000"
      strokeLinejoin="round"
      strokeMiterlimit={10}
      strokeWidth={0.93}
      d="M12 5L20 19H4L12 5ZM12 5V14.4316M12 14.4316L4.01969 19M12 14.4316L19.9803 19"
      transform="matrix(4.92188 0 0 4.92188 .937 .937)"
    />
  </svg>
)
export { TrinityLight }
export default TrinityLight
