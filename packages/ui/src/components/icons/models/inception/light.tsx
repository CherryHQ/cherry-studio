import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const InceptionLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
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
    viewBox="0 0 24 24"
    {...props}>
    <path d="M14.767 1H7.884L1 7.883v6.884h6.884V7.883h6.883V1zM9.234 23h6.882L23 16.116V9.233h-6.884v6.883H9.234V23z" />
  </svg>
)
export { InceptionLight }
export default InceptionLight
