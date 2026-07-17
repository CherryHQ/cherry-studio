import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const KwaipilotLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-kwaipilotlight__a)`}>
        <path
          fill={`url(#${iconId}-kwaipilotlight__b)`}
          d="M5.99974 0.00102938C2.68617 0.00102938 0 2.68771 0 6.00026C0 7.80888 0.800858 9.43067 2.06648 10.5316L5.0347 4.44538H8.35496L4.73618 11.8662C5.15153 11.9552 5.57512 12 5.99974 12C9.31332 12 11.9995 9.31332 11.9995 5.99974C11.9995 2.68617 9.3128 0 5.99974 0V0.00102938Z"
        />
        <path
          fill={`url(#${iconId}-kwaipilotlight__c)`}
          d="M2.06648 10.5311L5.34094 3.81643C5.34969 3.7979 5.35895 3.77885 5.36925 3.75981L5.41351 3.66717H5.41608C5.70985 3.11511 6.14827 2.65337 6.68438 2.33141C7.22049 2.00946 7.83409 1.83941 8.45945 1.8395C9.89234 1.8395 11.1209 2.71448 11.6423 3.95797C10.8075 1.64958 8.59533 0 5.99974 0C2.68617 0 0 2.68617 0 5.99974C0 7.80836 0.800858 9.43067 2.06648 10.5311Z"
        />
      </g>
      <defs>
        <linearGradient
          id={`${iconId}-kwaipilotlight__b`}
          x1={6.877}
          x2={6.407}
          y1={2.468}
          y2={10.95}
          gradientUnits="userSpaceOnUse">
          <stop offset={0.313} stopColor="#9EC0E0" />
          <stop offset={1} stopColor="#fff" />
        </linearGradient>
        <linearGradient
          id={`${iconId}-kwaipilotlight__c`}
          x1={7.016}
          x2={2.851}
          y1={2.162}
          y2={8.934}
          gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" />
          <stop offset={1} stopColor="#BCD5EC" />
        </linearGradient>
        <clipPath id={`${iconId}-kwaipilotlight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { KwaipilotLight }
export default KwaipilotLight
