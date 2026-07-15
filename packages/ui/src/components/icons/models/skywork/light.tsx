import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const SkyworkLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="1.145 0.756 21.709 21.986"
    {...props}>
    <path
      fill="#4D5EFF"
      d="M13.433 1.756a8.316 8.316 0 00-10.69.392 8.335 8.335 0 00-.598 11.765 8.317 8.317 0 0010.596 1.476L6.278 8.226l7.155-6.47z"
    />
    <path
      fill="#00FFCE"
      d="M10.568 21.742a8.316 8.316 0 0010.688-.392 8.336 8.336 0 00.598-11.765 8.317 8.317 0 00-10.596-1.476l6.463 7.163-7.155 6.47h.002z"
    />
  </svg>
)
export { SkyworkLight }
export default SkyworkLight
