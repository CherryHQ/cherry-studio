import type { SVGProps } from 'react'

import type { IconComponent } from '../types'
const OmpCli: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    style={{
      flex: 'none',
      lineHeight: 1,
    }}
    viewBox="12 16 40 40"
    {...props}
  >
    <path d="M14 16h36v8H40v32h-8V24h-6v22h-8V24h-4z" />
  </svg>
)
export { OmpCli }
export default OmpCli
