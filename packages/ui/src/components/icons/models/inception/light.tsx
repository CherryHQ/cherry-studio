import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const InceptionLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-inceptionlight__a)`}>
        <path
          fill="#000"
          fillRule="evenodd"
          d="M7.50927 0H3.75491L0 3.75436V7.50927H3.75491V3.75436H7.50927V0ZM4.49127 12H8.24509L12 8.24509V4.49073H8.24509V8.24509H4.49127V12Z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-inceptionlight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { InceptionLight }
export default InceptionLight
