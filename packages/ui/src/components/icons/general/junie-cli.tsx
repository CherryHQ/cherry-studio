import type { SVGProps } from 'react'

import type { IconComponent } from '../types'
const JunieCli: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: 'none',
      lineHeight: 1,
    }}
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      fill="#47E054"
      d="M24 9.333C24 18.666 20 24 9.333 24H8v-8h1.333C14 16 16 14 16 9.333V8h8v1.333zM8 16H0V8h8v8zM16 8H8V0h8v8z"
    />
  </svg>
)
export { JunieCli }
export default JunieCli
