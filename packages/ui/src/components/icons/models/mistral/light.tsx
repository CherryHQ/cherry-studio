import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const MistralLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="0 2.4 24 19.143"
    {...props}>
    <path fill="gold" d="M3.428 3.4h3.429v3.428H3.428V3.4zm13.714 0h3.43v3.428h-3.43V3.4z" />
    <path fill="#FFAF00" d="M3.428 6.828h6.857v3.429H3.429V6.828zm10.286 0h6.857v3.429h-6.857V6.828z" />
    <path fill="#FF8205" d="M3.428 10.258h17.144v3.428H3.428v-3.428z" />
    <path
      fill="#FA500F"
      d="M3.428 13.686h3.429v3.428H3.428v-3.428zm6.858 0h3.429v3.428h-3.429v-3.428zm6.856 0h3.43v3.428h-3.43v-3.428z"
    />
    <path fill="#E10500" d="M0 17.114h10.286v3.429H0v-3.429zm13.714 0H24v3.429H13.714v-3.429z" />
  </svg>
)
export { MistralLight }
export default MistralLight
