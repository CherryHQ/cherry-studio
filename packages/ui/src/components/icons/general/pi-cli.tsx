import type { SVGProps } from 'react'

import type { IconComponent } from '../types'
const PiCli: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="1em" height="1em" {...props}>
    <rect width={800} height={800} fill="#09090b" rx={150} />
    <path
      fill="#fff"
      fillRule="evenodd"
      d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
    />
    <path fill="#fff" d="M517.36 400H634.72V634.72H517.36Z" />
  </svg>
)
export { PiCli }
export default PiCli
