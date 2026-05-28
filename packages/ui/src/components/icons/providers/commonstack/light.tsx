import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const CommonstackLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 512 512" {...props}>
    <rect width={512} height={512} fill="#1A1A71" rx={92.16} />
    <path
      fill="#fff"
      d="M258.038 301.836L122.238 226.018V201.994L258.038 277.797L427.815 183.036L258.053 88.2747L88.2764 183.036V255.901L258.038 350.663H258.053V374.701H258.038L132.206 304.458L88.2764 328.962L258.053 423.723L427.815 328.962V255.901L384.08 231.488L258.038 301.836Z"
    />
  </svg>
)
export { CommonstackLight }
export default CommonstackLight
