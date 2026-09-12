import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const RequestyLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 120 120" {...props}>
    <rect width={120} height={120} fill="#334155" rx={24} />
    <path
      stroke="#fff"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={7}
      d="M28 40H48C56 40 58 60 66 60H92"
    />
    <path stroke="#fff" strokeLinecap="round" strokeWidth={7} d="M28 60H92" />
    <path
      stroke="#fff"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={7}
      d="M28 80H48C56 80 58 60 66 60M80 48 94 60 80 72"
    />
  </svg>
)
export { RequestyLight }
export default RequestyLight
