import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const SunoLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
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
    <path d="M16.5 0C20.642 0 24 5.373 24 12h-9c0 6.627-3.358 12-7.5 12C3.358 24 0 18.627 0 12h9c0-6.627 3.358-12 7.5-12z" />
  </svg>
)
export { SunoLight }
export default SunoLight
