import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const Streamlake: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: '0 0 auto',
      lineHeight: 1
    }}
    viewBox="0 0 24 24"
    {...props}>
    <path
      fill="#1D70FF"
      d="M12 3.9c-2.54 0-4.88-.92-6.76-2.44-.18-.14-.44-.12-.56.08L.98 6.42c-.12.16-.1.4.06.54C4.04 9.6 7.86 11.2 12 11.2c4.14 0 7.96-1.58 10.96-4.24.16-.14.18-.38.06-.54l-3.68-4.9c-.14-.18-.4-.22-.56-.08-1.88 1.54-4.22 2.44-6.76 2.44L12 3.9zM12 20.1c-2.54 0-4.88.92-6.76 2.44-.18.14-.44.12-.56-.08L1 17.56c-.12-.16-.1-.4.06-.54 3-2.64 6.82-4.24 10.96-4.24 4.14 0 7.96 1.58 10.96 4.24.16.14.18.38.06.54l-3.68 4.9c-.14.18-.4.22-.56.08-1.88-1.54-4.22-2.44-6.76-2.44H12z"
    />
  </svg>
)
export { Streamlake }
export default Streamlake
