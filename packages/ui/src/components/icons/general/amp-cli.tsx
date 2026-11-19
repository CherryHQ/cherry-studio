import type { SVGProps } from 'react'

import type { IconComponent } from '../types'
const AmpCli: IconComponent = (props: SVGProps<SVGSVGElement>) => (
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
      fill="#F34E3F"
      d="M15.087 23.18L12.03 24l-2.097-7.823-5.738 5.738-2.251-2.251 5.718-5.719-7.769-2.082.82-3.057 11.294 3.08 3.08 11.295z"
    />
    <path fill="#F34E3F" d="M19.505 18.762l-3.057.82-2.564-9.573-9.572-2.564.819-3.057 11.295 3.079 3.08 11.295z" />
    <path fill="#F34E3F" d="M23.893 14.374l-3.057.82-2.565-9.572L8.7 3.057 9.52 0l11.295 3.08 3.079 11.294z" />
  </svg>
)
export { AmpCli }
export default AmpCli
