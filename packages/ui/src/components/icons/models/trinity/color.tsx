import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Trinity: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 25 22" {...props}>
    <path
      stroke="currentColor"
      strokeLinejoin="round"
      strokeMiterlimit={10}
      strokeWidth={1.5}
      d="M12.25 0.75L23.75 20.75H0.75L12.25 0.75ZM12.25 0.75L12.25 14.2237M0.778309 20.75L12.25 14.2237M12.25 14.2237L23.7217 20.75"
    />
  </svg>
)
export { Trinity }
export default Trinity
