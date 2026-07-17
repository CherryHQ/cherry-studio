import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const StabilityLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <path
        fill={`url(#${iconId}-stabilitylight__a)`}
        d="M3.39436 10.8182C5.71364 10.8182 7.22236 9.60727 7.22236 7.78546C7.22236 6.37273 6.30491 5.47491 4.66418 5.10291L3.61145 4.79146C2.68745 4.58691 2.148 4.34145 2.27509 3.71418C2.38091 3.19218 2.69673 2.89764 3.43255 2.89764C5.76982 2.89764 6.636 3.71418 6.636 3.71418V1.75055C6.636 1.75055 5.79273 1 3.43255 1C1.20709 1 0 2.12909 0 3.87618C0 5.28891 0.836727 6.11091 2.53364 6.50091L2.71582 6.54618C2.97382 6.62473 3.32236 6.72891 3.76091 6.85818C4.62818 7.06273 4.85127 7.27982 4.85127 7.93055C4.85127 8.52509 4.224 8.86327 3.39491 8.86327C1.00418 8.86327 0 7.67146 0 7.67146V9.84727C0 9.84727 0.628364 10.8182 3.39436 10.8182Z"
      />
      <path
        fill="#E80000"
        d="M10.5676 10.6709C11.3885 10.6709 12 10.0856 12 9.29307C12 8.48362 11.406 7.91525 10.5676 7.91525C9.74673 7.91525 9.15273 8.48362 9.15273 9.29307C9.15273 10.1025 9.74673 10.6709 10.5676 10.6709Z"
      />
      <defs>
        <linearGradient
          id={`${iconId}-stabilitylight__a`}
          x1={3.611}
          x2={3.611}
          y1={1}
          y2={10.818}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#9D39FF" />
          <stop offset={1} stopColor="#A380FF" />
        </linearGradient>
      </defs>
    </svg>
  )
}
export { StabilityLight }
export default StabilityLight
