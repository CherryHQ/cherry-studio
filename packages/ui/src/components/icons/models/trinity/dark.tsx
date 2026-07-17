import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const TrinityDark: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0.5 12 12" {...props}>
    <path
      stroke="#fff"
      strokeLinejoin="round"
      strokeMiterlimit={10}
      d="M6 2L11 11H1L6 2ZM6 2V8.06316M6 8.06316L1.01231 11M6 8.06316L10.9877 11"
    />
  </svg>
)
export { TrinityDark }
export default TrinityDark
