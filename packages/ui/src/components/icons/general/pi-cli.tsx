import type { SVGProps } from 'react'

import type { IconComponent } from '../types'
const PiCli: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="currentColor"
    viewBox="4.25 3 15.5 16.75"
    {...props}>
    <path d="M5.25 4a1.25 1.25 0 0 0 0 2.5H7.5v12.25a1.25 1.25 0 0 0 2.5 0V6.5h4v12.25a1.25 1.25 0 0 0 2.5 0V6.5h2.25a1.25 1.25 0 0 0 0-2.5H5.25Z" />
  </svg>
)
export { PiCli }
export default PiCli
