import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const AdobeLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="0 2 24 21"
    {...props}>
    <path fill="#EB1000" d="M14.86 3H23v19zM9.14 3H1v19zM11.992 9.998L17.182 22h-3.394l-1.549-3.813h-3.79z" />
  </svg>
)
export { AdobeLight }
export default AdobeLight
