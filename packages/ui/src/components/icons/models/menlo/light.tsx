import type { SVGProps } from 'react'

import type { IconComponent } from '../../types'
const MenloLight: IconComponent = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    style={{
      flex: 'none',
      lineHeight: 1
    }}
    viewBox="2 0 20 24"
    {...props}>
    <path
      fill="#FF5C00"
      d="M19.46 1.492L21 3.036V10.5l-1.54 1.51-1.539-1.51V3.036l1.54-1.544zm-7.469 0l1.557 1.544V10.5l-1.557 1.51-1.54-1.51V3.036l1.54-1.544zM4.54 12.01L3 10.499V3.036l1.54-1.544 1.539 1.544V10.5l-1.54 1.51zM3 13.519l1.54-1.51 1.539 1.51v8.971L4.539 24 3 22.49v-8.972zM19.46 24l-1.539-1.51v-8.972l1.54-1.51L21 13.519v8.972L19.46 24zM6.08 0h4.373l1.54 1.492-1.54 1.544H6.079l-1.54-1.544L6.08 0zm7.47 0h4.372l1.54 1.492-1.54 1.544h-4.373l-1.557-1.544L13.548 0z"
    />
  </svg>
)
export { MenloLight }
export default MenloLight
