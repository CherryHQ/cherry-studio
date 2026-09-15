import type { SVGProps } from 'react'

import type { IconComponent } from '../types'
const PiCli: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    viewBox="0 0 24 24"
    {...props}>
    <path d="M1 1h16.5v11H12v5.5H6.5V23H1V1Zm5.5 5.5V12H12V6.5H6.5Z" clipRule="evenodd" />
    <path d="M17.5 12H23v11h-5.5V12Z" />
  </svg>
)
export { PiCli }
export default PiCli
