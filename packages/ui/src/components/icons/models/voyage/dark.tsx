import { type SVGProps, useId } from 'react'

import type { IconComponent } from '../../types'
const VoyageDark: IconComponent = (props: SVGProps<SVGSVGElement>) => {
  const iconId = useId()

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 12 12" {...props}>
      <g clipPath={`url(#${iconId}-voyagedark__a)`}>
        <path
          fill="#fff"
          d="M2.2035 0V0.033C2.19028 0.0726347 2.18221 0.113806 2.1795 0.1555C2.174 0.2105 2.1715 0.2595 2.1715 0.303C2.1715 0.4725 2.193 0.6605 2.2355 0.868C2.284 1.0705 2.3725 1.324 2.501 1.63L6.0635 9.813L9.5055 1.695C9.586 1.493 9.672 1.272 9.763 1.0315C9.854 0.7915 9.8995 0.5485 9.8995 0.3025C9.90138 0.210222 9.88507 0.118476 9.8515 0.0325V0H11.5V0.033C11.398 0.1365 11.275 0.322 11.13 0.59C10.985 0.8575 10.827 1.1875 10.6555 1.581L6.0475 12H5.404L1.0375 1.9825C0.9355 1.7475 0.8285 1.521 0.7155 1.3025C0.6085 1.084 0.5065 0.8875 0.4105 0.7125C0.3135 0.5325 0.228 0.3825 0.153 0.2625C0.105784 0.183221 0.0547234 0.106296 0 0.032V0H2.2035Z"
        />
      </g>
      <defs>
        <clipPath id={`${iconId}-voyagedark__a`}>
          <path fill="#fff" d="M0 0H12V12H0z" />
        </clipPath>
      </defs>
    </svg>
  )
}
export { VoyageDark }
export default VoyageDark
