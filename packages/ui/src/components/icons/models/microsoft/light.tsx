import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const MicrosoftLight: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-microsoftlight__a)`}>
        <path fill="#F25022" d="M5.4534 0H0V5.45455H5.45455V0H5.4534Z" />
        <path fill="#7FBA00" d="M12 0H6.54546V5.45455H12V0Z" />
        <path fill="#00A4EF" d="M5.4534 6.54546H0V12H5.45455V6.54546H5.4534Z" />
        <path fill="#FFB900" d="M12 6.54546H6.54546V12H12V6.54546Z" />
      </g>
      <defs>
        <clipPath id={`${iconId}-microsoftlight__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { MicrosoftLight }
export default MicrosoftLight
