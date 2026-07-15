import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const ZaiLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="currentColor"
    fillRule="evenodd"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="0 1 24 22"
    {...props}>
    <path d="M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z" />
  </svg>
)
export { ZaiLight }
export default ZaiLight
