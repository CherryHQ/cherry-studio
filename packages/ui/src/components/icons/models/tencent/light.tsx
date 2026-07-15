import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const TencentLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="0 0 24 24"
    {...props}>
    <path
      fill="#0052D9"
      fillRule="evenodd"
      d="M9.976 1L24 9.8l-10.587.015L10.723 23H5.489L8.18 9.8H3.244L1 5.4h8.077L9.976 1z"
    />
  </svg>
)
export { TencentLight }
export default TencentLight
